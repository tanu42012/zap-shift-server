
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const stripe = Stripe(process.env.PAYMENT_GATEWAY_KEY); // <-- make sure the ENV var matches

const app = express();
const PORT = process.env.PORT || 3000;

/* ──────────  Global middleware  ────────── */
app.use(cors());
app.use(express.json());

/* ──────────  Firebase Admin  ────────── */
const serviceAccount = require('./firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/* ──────────  MongoDB  ────────── */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jpgqqnp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

/* ──────────  Main async block  ────────── */
async function run() {
  try {
    await client.connect();

    const db = client.db('parcelDB');
    const usersCollection = db.collection('users');
    const parcelCollection = db.collection('parcels');
    const paymentsCollection = db.collection('payments');
    const ridersCollection = db.collection('riders');
    const trackingCollection = db.collection('tracking');

    /* ─────  Auth & role middlewares  ───── */
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = authHeader.split(' ')[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (err) {
        console.error('verifyFBToken error:', err);
        return res.status(403).send({ message: 'forbidden access' });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== 'admin') {
          return res.status(403).send({ message: 'forbidden access' });
        }
        next();
      } catch (err) {
        console.error('verifyAdmin error:', err);
        res.status(500).send({ message: 'internal server error' });
      }
    };

    /* ──────────────  User routes  ────────────── */
    app.post('/users', async (req, res) => {
      const { email } = req.body;
      try {
        const existing = await usersCollection.findOne({ email });
        if (existing) {
          return res
            .status(200)
            .send({ message: 'user already exists', inserted: false });
        }
        const result = await usersCollection.insertOne(req.body);
        res.send(result);
      } catch (err) {
        console.error('POST /users error:', err);
        res.status(500).send({ message: 'failed to create user' });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      const { email } = req.params;
      try {
        const user = await usersCollection.findOne(
          { email },
          { projection: { role: 1 } },
        );
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }
        res.send({ role: user.role || 'user' });
      } catch (err) {
        console.error('GET /users/:email/role error:', err);
        res.status(500).send({ message: 'internal server error' });
      }
    });

    app.get('/users/search', async (req, res) => {
      const emailQuery = req.query.email;
      if (!emailQuery) {
        return res.status(400).json({ message: 'Missing email query ?email=' });
      }
      const regex = new RegExp(emailQuery, 'i');
      try {
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .project({ email: 1, created_at: 1, role: 1 })
          .limit(20)
          .toArray();
        res.send(users);
      } catch (err) {
        console.error('GET /users/search error:', err);
        res.status(500).json({ message: 'error searching users' });
      }
    });

    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      if (!['admin', 'user'].includes(role)) {
        return res.status(400).send({ message: 'invalid role' });
      }
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'invalid user id' });
      }
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } },
        );
        res.send({ message: `user role updated to ${role}`, result });
      } catch (err) {
        console.error('PATCH /users/:id/role error:', err);
        res.status(500).send({ message: 'failed to update user' });
      }
    });

    /* ─────────────  Parcel routes  ───────────── */
    app.get('/parcels', async (req, res) => {
      const { email, payment_status, delivery_status } = req.query;
      let query = {}
      if (email) {
        query = { created_by: email }

      }
      if (payment_status) {
        query.payment_status = payment_status
      }
      if (delivery_status) {
        query.delivery_status = delivery_status
      }
      try {

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 })
          .toArray();
        res.send(parcels);
      } catch (err) {
        console.error('GET /parcels error:', err);
        res.status(500).json({ message: 'Failed to fetch parcels' });
      }
    });

    app.get('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid parcel ID' });
      }
      try {
        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
        if (!parcel) {
          return res.status(404).json({ message: 'Parcel not found' });
        }
        res.send(parcel);
      } catch (err) {
        console.error('GET /parcels/:id error:', err);
        res.status(500).json({ message: 'Failed to fetch parcel' });
      }
    });

    app.post('/parcels', async (req, res) => {
      try {
        const result = await parcelCollection.insertOne(req.body);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error('POST /parcels error:', err);
        res.status(500).json({ message: 'Failed to create parcel' });
      }
    });

    app.delete('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid parcel ID' });
      }
      try {
        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.json({ message: 'Parcel deleted successfully' });
        } else {
          res.status(404).json({ message: 'Parcel not found' });
        }
      } catch (err) {
        console.error('DELETE /parcels/:id error:', err);
        res.status(500).json({ message: 'Failed to delete parcel' });
      }
    });

    /* ─────────────  Rider routes  ───────────── */
    app.post('/riders', async (req, res) => {
      try {
        const result = await ridersCollection.insertOne(req.body);
        res.send(result);
      } catch (err) {
        console.error('POST /riders error:', err);
        res.status(500).send({ message: 'failed to create rider' });
      }
    });
    // GET /riders?district=Pabna
    app.get('/riders/available', async (req, res) => {
      const { district } = req.query;

      if (!district) {
        return res.status(400).json({ message: 'Missing district query param' });
      }

      try {
        const riders = await ridersCollection
          .find({ district, status: 'approved' }) // status field is optional
          .project({ name: 1, phone: 1, district: 1 }) // return basic info
          .toArray();

        res.json(riders);
      } catch (error) {
        console.error('Error fetching riders:', error);
        res.status(500).json({ message: 'Server error' });
      }
    });
    // PATCH /parcels/:id/assign-rider   body { riderId: '...' }
    app.patch('/parcels/:id/assign-rider', async (req, res) => {
      const parcelId = req.params.id;
      const { riderId } = req.body;

      if (!ObjectId.isValid(parcelId) || !ObjectId.isValid(riderId)) {
        return res.status(400).json({ message: 'Invalid IDs' });
      }

      try {
        /* 2.1 find parcel (must still be paid + not collected) */
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(parcelId),
          payment_status: 'paid',
          delivery_status: 'not collected',
        });

        if (!parcel) {
          return res.status(404).json({ message: 'Parcel not eligible / not found' });
        }

        /* 2.2 make sure rider exists & matches district */
        const rider = await ridersCollection.findOne({
          _id: new ObjectId(riderId),
          district: parcel.senderServiceCenter,   // the match requirement
          status: 'approved',
        });

        if (!rider) {
          return res.status(404).json({ message: 'Rider not found in district' });
        }

        /* 2.3 update parcel */
        const parcelUpdate = await parcelsCollection.updateOne(
          { _id: parcel._id },
          {
            $set: {
              rider_id: rider._id,
              delivery_status: 'collecting',      // or 'assigned'
              riderAssignedAt: new Date(),
            },
          }
        );

        /* 2.4 (optional) update rider doc with workload */
        await ridersCollection.updateOne(
          { _id: rider._id },
          {
            $inc: { activeParcels: 1 },          // track rider workload
            $push: { assignedParcels: parcel._id },
          }
        );

        res.json({ message: 'Rider assigned successfully', parcelUpdate });
      } catch (err) {
        console.error('Assign rider error:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });



    // app.patch("/riders/:id/status", async (req, res) => {
    //   const { id } = req.params;
    //   const { status, email } = req.body;
    //   const query = { _id: new ObjectId(id) }
    //   const updateDoc = {
    //     $set:
    //     {
    //       status
    //     }
    //   }

    //   try {
    //     const result = await ridersCollection.updateOne(
    //       query, updateDoc

    //     );

    //     // update user role for accepting rider
    //     if (status === 'active') {
    //       const userQuery = { email };
    //       const userUpdateDoc = {
    //         $set: {
    //           role: 'rider'
    //         }
    //       };
    //       const roleResult = await usersCollection.updateOne(userQuery, userUpdateDoc)
    //       console.log(roleResult.modifiedCount)
    //     }

    //     res.send(result);
    //   } catch (err) {
    //     res.status(500).send({ message: "Failed to update rider status" });
    //   }
    // });



    app.get('/riders/pending', async (_req, res) => {
      try {
        const riders = await ridersCollection
          .find({ status: 'pending' })
          .sort({ appliedAt: -1 })
          .toArray();
        res.send(riders);
      } catch (err) {
        console.error('GET /riders/pending error:', err);
        res.status(500).json({ error: 'internal server error' });
      }
    });

    app.get('/riders/approved', async (_req, res) => {
      try {
        const riders = await ridersCollection.find({ status: 'active' }).toArray();
        res.send(riders);
      } catch (err) {
        console.error('GET /riders/approved error:', err);
        res.status(500).json({ error: 'internal server error' });
      }
    });

    app.patch('/riders/:id', async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid rider ID' });
      }
      if (!['active', 'reject'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      try {
        const riderResult = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } },
        );

        if (status === 'active' && email) {
          await usersCollection.updateOne(
            { email },
            { $set: { role: 'rider' } },
          );
        }

        if (riderResult.modifiedCount) {
          res.send({ modifiedCount: riderResult.modifiedCount });
        } else {
          res.status(404).json({ error: 'No rider updated' });
        }
      } catch (err) {
        console.error('PATCH /riders/:id error:', err);
        res.status(500).json({ error: 'internal server error' });
      }
    });

    /* ────────────  Tracking routes  ──────────── */
    app.post('/tracking', async (req, res) => {
      const { tracking_id, parcel_id, status, message, update_by = '' } = req.body;
      const log = {
        tracking_id,
        parcel_id:
          parcel_id && ObjectId.isValid(parcel_id) ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        update_by,
      };
      try {
        const result = await trackingCollection.insertOne(log);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error('POST /tracking error:', err);
        res.status(500).json({ error: 'failed to create tracking log' });
      }
    });

    /* ────────────  Payment routes  ──────────── */
    app.get('/payments', async (req, res) => {
      const { userEmail, parcelId, transactionId, limit = 50, skip = 0 } = req.query;
      try {
        const query = {};
        if (userEmail) query.userEmail = userEmail;

        if (parcelId) {
          if (!ObjectId.isValid(parcelId)) {
            return res.status(400).send({ message: 'invalid parcel id' });
          }
          query.parcelId = new ObjectId(parcelId);
        }
        if (transactionId) query.transactionId = transactionId;

        const payments = await paymentsCollection
          .find(query)
          .sort({ paid_at: -1 })
          .skip(parseInt(skip))
          .limit(parseInt(limit))
          .toArray();
        res.send(payments);
      } catch (err) {
        console.error('GET /payments error:', err);
        res.status(500).json({ error: 'failed to load payment history' });
      }
    });

    app.post('/payments', async (req, res) => {
      const { transactionId, amount, parcelId, userEmail } = req.body;
      if (!transactionId || !amount || !parcelId || !userEmail) {
        return res.status(400).json({ error: 'Missing required payment fields' });
      }
      if (!ObjectId.isValid(parcelId)) {
        return res.status(400).json({ error: 'Invalid parcel ID' });
      }
      try {
        // 1) mark parcel paid
        const parcelUpdateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: 'paid' } },
        );
        // 2) save payment
        const paymentData = {
          transactionId,
          amount,
          parcelId: new ObjectId(parcelId),
          userEmail,
          paid_at: new Date(),
        };
        const insertResult = await paymentsCollection.insertOne(paymentData);

        res.status(201).send({
          message: 'Payment recorded successfully',
          parcelUpdate: parcelUpdateResult,
          paymentRecord: insertResult,
          insertedId: insertResult.insertedId,
        });
      } catch (err) {
        console.error('POST /payments error:', err);
        res.status(500).json({ error: 'failed to record payment' });
      }
    });

    app.post('/create-payment-intent', async (req, res) => {
      const { amountInCents } = req.body;
      if (!amountInCents || isNaN(amountInCents)) {
        return res.status(400).send({ error: 'invalid amount' });
      }
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error('POST /create-payment-intent error:', err);
        res.status(400).send({ error: err.message });
      }
    });

    /* ─────────  Confirm DB connection  ───────── */
    await client.db('admin').command({ ping: 1 });
    console.log('Connected to MongoDB successfully');
  } catch (err) {
    console.error('run() error:', err);
  }
}

run().catch(console.dir);

/* ──────────  Health check & server start  ────────── */
app.get('/', (_req, res) => res.send('Parcel server is running'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
