const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { default: Stripe } = require('stripe');
dotenv.config();
const stripe = Stripe(process.env.PAYMENT_gateway_KEY);

const app = express();
const PORT = process.env.PORT || 3000;



// Middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jpgqqnp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('parcelDB');
    const parcelCollection = db.collection('parcels');

    app.get('/parcels', async (req, res) => {
      const parcels = await parcelCollection.find({}).toArray();
      res.status(200).json(parcels);
    });
    // Make sure you have this at the top of the file
    const { ObjectId } = require('mongodb');

    // GET /parcels/:id  ── fetch one parcel
    app.get('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;

        // Validate & convert the string id to an ObjectId
        // if (!ObjectId.isValid(id)) {
        //   return res.status(400).json({ message: 'Invalid parcel ID' });
        // }
        const objectId = new ObjectId(id);

        // Query the collection
        const parcel = await parcelCollection.findOne({ _id: objectId });

        if (!parcel) {
          return res.status(404).json({ message: 'Parcel not found' });
        }

        res.json(parcel);          // 200 OK with the document
      } catch (error) {
        console.error('Error fetching parcel by id:', error);
        res.status(500).json({ message: 'Failed to fetch parcel' });
      }
    });



    // parcel api
    app.get('/parcels', async (req, res) => {
      try {
        const { email } = req.query;

        // If email is provided, filter by created_by
        const query = email ? { created_by: email } : {};

        // Sort all parcels by newest first
        const options = { sort: { creation_date: -1 } };

        const parcels = await parcelCollection.find(query, options).toArray();

        res.status(200).json(parcels);
      } catch (error) {
        console.error('Error fetching parcels:', error);
        res.status(500).json({ message: 'Failed to fetch parcels' });
      }
    });


    // post: create a new parcel
    app.post('/parcels', async (req, res) => {
      try {
        const parcelData = req.body;
        const result = await parcelCollection.insertOne(parcelData);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (error) {
        console.error('Error inserting parcel:', error);
        res.status(500).json({ message: 'Failed to create parcel' });
      }
    });
    // delete api
    // Assuming you have already setup express app and MongoDB client/connection

    app.delete('/parcels/:id', async (req, res) => {
      const parcelId = req.params.id;
      try {
        const result = await parcelCollection.deleteOne({ _id: new ObjectId(parcelId) });

        if (result.deletedCount === 1) {
          res.status(200).json({ message: 'Parcel deleted successfully' });
        } else {
          res.status(404).json({ message: 'Parcel not found' });
        }
      } catch (error) {
        console.error('Error deleting parcel:', error);
        res.status(500).json({ message: 'Failed to delete parcel' });
      }
    });
    app.post('/create-payment-intent', async (req, res) => {
      // const { amount, currency = 'usd' } = req.body; // amount in cents
      const amountInCents=req.body.amountInCents
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount:amountInCents,
          currency:'usd',
          
          automatic_payment_methods: { enabled: true }, // works with Card Element or Payment Element
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error(err);
        res.status(400).send({ error: err.message });
      }
      // try {
      //   const result = await axiosSecure.post('/create-payment-intent', {
      //     amount: amountInCents,
      //     parcelId,
      //   });
      //   console.log('res for intent', result.data);
      // } catch (error) {
      //   console.error('Payment intent creation failed:', error.response?.data || error.message);
      // }
      
    });





    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


// Test route
app.get('/', (req, res) => {
  res.send('Parcel server is running');
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});