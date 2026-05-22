require("./mongodb-dns");

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const uri = process.env.MONGODB_URI_STANDARD || process.env.MONGODB_URI;
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET || "ideavault-jwt-secret";

const app = express();
app.use(cors())
app.use(express.json())


const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }

});

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function buildIdeasQuery(queryParams) {
  const { search, category, startDate, endDate } = queryParams;
  const query = {};

  if (search) {
    query.title = { $regex: search, $options: "i" };
  }
  if (category && category !== "All") {
    query.category = category;
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  return query;
}

async function run() {

  // await client.connect();

  const db = client.db("ideaVault");
  const ideaCollection = db.collection("ideas");
  const commentCollection = db.collection("comments");

  app.post("/auth/token", (req, res) => {
    const { email, name, image } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    const token = jwt.sign({ email, name, image }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { email, name, image } });
  })

  app.get("/ideas/trending", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 6, 20);
    const ideas = await ideaCollection
      .aggregate([
        {
          $lookup: {
            from: "comments",
            localField: "_id",
            foreignField: "ideaId",
            as: "comments",
          },
        },

        {
          $addFields: {
            interactionScore: {
              $add: [
                { $ifNull: ["$likes", 0] },
                { $multiply: [{ $size: "$comments" }, 2] },
              ],
            },
          },
        },
        { $sort: { interactionScore: -1, createdAt: -1 } },
        { $limit: limit },
        { $project: { comments: 0 } },
      ])
      .toArray();
    res.send(ideas);
  });

  app.get("/ideas", async (req, res) => {
    const query = buildIdeasQuery(req.query);
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 0;
    let cursor = ideaCollection.find(query).sort({ createdAt: -1 });
    if (limit > 0) cursor = cursor.limit(limit);
    const result = await cursor.toArray();
    res.send(result);
  });

  app.get("/idea/:id", async (req, res) => {
    try {
      const result = await ideaCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!result) return res.status(404).json({ message: "Idea not found" });
      res.send(result);
    } catch {
      res.status(400).json({ message: "Invalid idea id" });
    }
  });

  app.post("/ideas", verifyToken, async (req, res) => {

    const ideaData = {
      ...req.body,
      authorEmail: req.user.email,
      authorName: req.user.name,
      authorImage: req.user.image,
      likes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await ideaCollection.insertOne(ideaData);
    res.json({ insertedId: result.insertedId, acknowledged: result.acknowledged });

  });

  app.get("/my-ideas", verifyToken, async (req, res) => {

    const result = await ideaCollection
      .find({ authorEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);

  });

  app.put("/idea/:id", verifyToken, async (req, res) => {
    
    try {

      const idea = await ideaCollection.findOne({ _id: new ObjectId(req.params.id) });

      if (!idea) return res.status(404).json({ message: "Idea not found" });

      if (idea.authorEmail !== req.user.email) {
        return res.status(403).json({ message: "Not allowed" });
      }

      const updateIdea = { ...req.body, updatedAt: new Date() };
      delete updateIdea._id;
      const result = await ideaCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updateIdea }
      )

      res.send(result);
    } catch {
      res.status(400).json({ message: "Invalid idea id" });
    }
  })


  app.delete("/idea/:id", verifyToken, async (req, res) => {
    try {
      const idea = await ideaCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!idea) return res.status(404).json({ message: "Idea not found" });
      if (idea.authorEmail !== req.user.email) {
        return res.status(403).json({ message: "Not allowed" });
      }
      await commentCollection.deleteMany({ ideaId: req.params.id });
      const result = await ideaCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    } catch {
      res.status(400).json({ message: "Invalid idea id" });
    }
  })

  app.post("/comment", verifyToken, async (req, res) => {
    const commentData = {
      ideaId: req.body.ideaId,
      text: req.body.text,
      userEmail: req.user.email,
      userName: req.user.name,
      userImage: req.user.image,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await commentCollection.insertOne(commentData);
    res.json({ insertedId: result.insertedId, acknowledged: result.acknowledged });
  });

  app.get("/comments/:ideaId", async (req, res) => {
    const result = await commentCollection
      .find({ ideaId: req.params.ideaId })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  });

  app.put("/comment/:id", verifyToken, async (req, res) => {
    try {
      const comment = await commentCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (comment.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Not allowed" });
      }
      const result = await commentCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { text: req.body.text, updatedAt: new Date() } }
      );
      res.send(result);
    } catch {
      res.status(400).json({ message: "Invalid comment id" });
    }
  });

  app.delete("/comment/:id", verifyToken, async (req, res) => {
    try {
      const comment = await commentCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (comment.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Not allowed" });
      }
      const result = await commentCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    } catch {
      res.status(400).json({ message: "Invalid comment id" });
    }
  });

  app.get("/my-interactions", verifyToken, async (req, res) => {
    const comments = await commentCollection
      .find({ userEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    const ideaIds = [...new Set(comments.map((c) => c.ideaId).filter(Boolean))];
    const objectIds = [];
    for (const id of ideaIds) {
      try {
        objectIds.push(new ObjectId(id));
      } catch {

      }
    }
    const ideas =
      objectIds.length > 0
        ? await ideaCollection.find({ _id: { $in: objectIds } }).toArray()
        : [];

    const ideaMap = Object.fromEntries(ideas.map((i) => [i._id.toString(), i]));

    const interactions = comments.map((comment) => ({
      commentId: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      idea: ideaMap[comment.ideaId] || null,
      ideaId: comment.ideaId,
    }));

    res.send(interactions);
  });

  app.get("/", (req, res) => {
    res.send("IdeaVault API is running");
  });

  // await client.db("admin").command({ ping: 1 });

  console.log("Connected to MongoDB");

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

run().catch(console.error);
