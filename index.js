const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const uri = process.env.MONGODB_URI;

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT;


const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        await client.connect();

        const db = client.db("ideaVault");
        const ideaCollection = db.collection("ideas");

        app.get('/ideas', async (req, res) => {
            const result = await ideaCollection.find().toArray();
            res.send(result);
        })


        app.post('/ideas', async (req, res) => {
            const ideaData = req.body;
            console.log(ideaData);
            const result = await ideaCollection.insertOne(ideaData);
            res.send(result);
        });

        app.get('/idea/:id', async (req, res) => {
            const id = req.params;
            const result = await ideaCollection.findOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello world');
})


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})