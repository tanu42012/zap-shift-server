const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const { default: Stripe } = require('stripe');
dotenv.config();

const stripe = Stripe(process.env.PAYMENT_gateway_KEY);

const app = express();
const PORT = process.env.PORT || 3000;



// Middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});




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
    const usersCollection = db.collection('users');
    const parcelCollection = db.collection('parcels');
    const paymentsCollection = db.collection('payments');
    const ridersCollection = db.collection('riders');



    // custom middlewares
    const verifyFBToken = async (req, res, next) => {
      console.log('header in middleware', req.headers)
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access ' })
      }
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'unauthorized access ' })
      }

      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      }
      catch (error) {
        return res.status(403).send({ message: 'forbidden access ' })

      }





    }


    const { ObjectId } = require('mongodb');

    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExits = await usersCollection.findOne({ email });
      if (userExits) {
        return res.status(200).send({
          message: 'user already exists',
          inserted: false
        });



      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);


    });

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ message: 'Email is required in query' });
      }

      try {
        const user = await usersCollection.findOne(
          { email },
          { projection: { role: 1 } } // only return the role
        );

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.send({ role: user.role || 'user' }); // default to 'user' if role not set
      } catch (error) {
        console.error('Error fetching user role:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });


    app.get('/users/search', async (req, res) => {
      const emailQuery = req.query.email;

      if (!emailQuery) {
        return res.status(400).json({ message: 'Missing email query (?q=...)' });
      }
      const regex = new RegExp(emailQuery, 'i');

      try {
        // case‑insensitive
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .project({ email: 1, created_at: 1, role: 1 })
          .limit(20)
          .toArray();

        res.status(200).json(users);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'error searching users' });
      }
    });
    app.patch('/users/:id/role', async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      if (!['admin', 'user'].includes(role)) {
        return res.status(400).send({ message: 'invalid role' });

      }
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ message: `user role update to${role}`, result });

      }
      catch (error) {
        console.log(error);
        res.status(500).send({ message: 'failed to update user' });
      }
    });


    // app.get('/parcels', async (req, res) => {
    //   const parcels = await parcelCollection.find({}).toArray();
    //   res.status(200).json(parcels);
    // });
    // Make sure you have this at the top of the file


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
        // console.log(req.headers);

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

    // riders
    app.post('/riders', async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    })
    // GET /riders/pending
    app.get('/riders/pending', async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: 'pending' })
          .sort({ appliedAt: -1 }) // newest applicants first
          .toArray();

        res.send(pendingRiders);
      } catch (error) {
        console.error('Failed to fetch pending riders:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });


    app.get('/riders/approved', async (req, res) => {
      const approvedRiders = await ridersCollection.find({ status: 'active' }).toArray();
      res.send(approvedRiders);
    });


    app.patch('/riders/:id', async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      console.log('id', id, ObjectId.isValid(id), status);



      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      if (!['active', 'reject'].includes(status)) {
        return res.status(401).json({ error: 'Invalid status' });
      }

      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        if (status === 'active') {
          const userQuery = { email };
          const userUpdatedDoc = {
            $set: {
              role: 'rider'
            }
          }
          const roleResult = await usersCollection.updateOne(userQuery, userUpdatedDoc)
          console.log(roleResult.modifiedCount)

        }

        if (result.modifiedCount > 0) {
          return res.send({ modifiedCount: result.modifiedCount });
        } else {
          return res.status(404).json({ error: 'No rider updated' });
        }
      } catch (err) {
        console.error("PATCH /riders/:id error", err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });




    app.post('/tracking', async (req, res) => {
      const { tracking_id, parcel_id, status, message, update_by = '' } = req.body
      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcelId) : undefined,
        status,
        message,
        time: new Date(),
        update_by,

      };
      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    })



    app.get('/payments', async (req, res) => {
      // console.log('headers in payments',req.headers);
      try {
        console.log('decoded', req.decoded);
        const { userEmail, parcelId, transactionId, limit = 50, skip = 0 } = req.query;
        // if(req.decoded.email!==userEmail){
        //   return res.status(403).send({message:'forbidden access'});

        // }



        // 1️⃣  Build Mongo query dynamically
        const query = {};
        if (userEmail) query.userEmail = userEmail;

        if (parcelId) query.parcelId = new ObjectId(parcelId);
        if (transactionId) query.transactionId = transactionId;

        // 2️⃣  Fetch history, newest first
        const payments = await paymentsCollection
          .find(query)
          .sort({ paid_at: -1 })            // newest → oldest
          .skip(parseInt(skip))               // simple pagination
          .limit(parseInt(limit))             // default 50 docs
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ error: 'Failed to load payment history' });
      }
    });


    // post record payment and update parcel
    app.post('/payments', async (req, res) => {
      const { transactionId, amount, parcelId, userEmail } = req.body;
      console.log(req.body);

      // if (!transactionId || !amount || !parcelId || !userEmail) {
      //   return res.status(400).json({ error: 'Missing required payment fields' });
      // }


      try {
        // 1. Mark parcel as paid
        const parcelUpdateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: 'paid'
            }
          }
        );

        // 2. Save payment history
        const paymentData = {
          transactionId,
          amount,
          parcelId: new ObjectId(parcelId),
          userEmail,
          paid_at_string: new Date().toISOString(),
          createdAt: new Date()
        };
        console.log(paymentData);

        const insertResult = await paymentsCollection.insertOne(paymentData);

        res.status(201).send({
          message: 'Payment recorded successfully',
          parcelUpdate: parcelUpdateResult,
          paymentRecord: insertResult,
          insertedId: insertResult.insertedId
        });

      } catch (error) {
        console.error("Error saving payment:", error);
        res.status(500).json({ error: 'Failed to record payment' });
      }
    });


    app.post('/create-payment-intent', async (req, res) => {
      // const { amount, currency = 'usd' } = req.body; // amount in cents
      const amountInCents = req.body.amountInCents
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'usd',

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