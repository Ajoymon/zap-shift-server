const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000
const crypto = require("crypto");
function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
//middleware
app.use(express.json())
app.use(cors())
const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-c5f1a-firebase-adminsdk-fbsvc-b621e760b6.json");
const { assert } = require('console')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const verifyFBToken = async (req, res, next) => {

  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })

  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log('decoded in the token', decoded)
    req.decoded_email = decoded.email
    next()
  }
  catch (error) {
    return res.status(401).send({ message: 'unauthorized acces' })

  }

}




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@my-first-cluster.ofk8daf.mongodb.net/?appName=my-First-Cluster`;


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
    const db = client.db('zap_shift_db')
    const parcelsCollection = db.collection('parcels')
    const paymentCollection = db.collection('payments')
    const userCollection = db.collection('user')
    const ridersCollection = db.collection('riders')

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbiden akceg' })
      }
      next()
    }
    //  user rlated api

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      console.log(query)
      const user = await userCollection.findOne(query);
      console.log(user)
      res.send({ role: user?.role || 'user' })

    })

    app.get('/users', verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        query.$or = [
          {
            displayName: {
              $regex: searchText,
              $options: 'i',
            },
          },
          {
            email: {
              $regex: searchText,
              $options: 'i',
            },
          },
        ];
      }
      const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(5);
      const rusult = await cursor.toArray();
      res.send(rusult);
    })
    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const rusult = await userCollection.updateOne(query, updateDoc)
      res.send(rusult)
    })
    app.post('/users', verifyFBToken, async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;
      const userExisterts = await userCollection.findOne({ email })
      if (userExisterts) {
        return res.send({ message: 'user exists' })
      }

      const result = await userCollection.insertOne(user);
      res.send(result)
    })



    // parcl api
    app.get('/parcels', async (req, res) => {
      const quere = {}
      const { email, deliverystatus } = req.query
      if (email) {
        quere.senderEmail = email
      }
      if (deliverystatus) {
        quere.deliverystatus = deliverystatus
      }
      const options = { sort: { createdAt: -1 } }
      const cursor = parcelsCollection.find(quere, options);
      const result = await cursor.toArray();
      res.send(result)

    })
    app.post('/parcels', async (req, res) => {
      const parcel = req.body
      parcel.createdAt = new Date()
      const result = await parcelsCollection.insertOne(parcel)
      res.send(result)
    })
    app.patch('/parcels/:id', async (req, res) => {
      const { riderId, riderName, riderEmail } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          deliverystatus: 'briver_assigned',
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail
        }
      }
      const rusult = await parcelsCollection.updateOne(query, updateDoc)
      // update rider information
      const riderQuery = { _id: new ObjectId(riderId) }
      const riderUpdatedDoc = {
        $set: {
          workStatus: 'in_delivery'
        }
      }
      const riderRusult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);
      res.send(riderRusult)
    })
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const rusult = await parcelsCollection.deleteOne(query)
      res.send(rusult)

    })
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const rusult = await parcelsCollection.findOne(query)
      res.send(rusult);

    })
    //payment related api
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentinfo = req.body;
      const amount = parseInt(paymentinfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {

            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: `please pay for ${paymentinfo.parcelName}`
              }

            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          parcelId: paymentinfo.parcelId,
          parcelName: paymentinfo.parcelName
        },
        customer_email: paymentinfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,

      });
      res.send({ url: session.url })
    })

    // old
    // app.post('/create-checkout-session', async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100;

    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: 'USD',
    //           unit_amount: amount,
    //           product_data: {
    //             name: paymentInfo.parcelName
    //           }
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: 'payment',
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //       parcelName: paymentInfo.parcelName
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   })

    //   console.log(session)
    //   res.send({ url: session.url })
    // })

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session)
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }
      const paymentExison = await paymentCollection.findOne(query)
      console.log(paymentExison)
      if (paymentExison) {
        return res.send({ message: 'alredy exists', transactionId, trackingId: paymentExison.trackingId })
      }





      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            deliverystatus: 'pending-pickup',

            trackingId: trackingId
          }
        }

        const result = await parcelsCollection.updateOne(query, update);
        // res.send(result)

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }


        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(payment);
          return res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment
          })
        }

      }
      return res.send({ success: false })
    })
    // payment related api
    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {}
      // console.log('headers', req.headers)
      if (email) {
        query.customerEmail = email
        // check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden' })
        }

      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
      const rusult = await cursor.toArray();
      res.send(rusult)
    })
    // riders realted api
    app.get('/riders', async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {}
      if (status) {
        query.status = status;
      }
      if (district) {
        query.district = district
      }
      if (workStatus) {
        query.workStatus = workStatus
      }
      const cursor = ridersCollection.find(query)
      const result = await cursor.toArray();
      res.send(result)
    })
    app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedDoct = {
        $set: {
          status: status,
          workStatus: 'available'


        }
      }
      const rusult = await ridersCollection.updateOne(query, updatedDoct)
      if (status === 'approved') {
        const email = req.body.email;
        const useQuery = { email }
        const updateUser = {
          $set: {
            role: 'rider'

          }
        }
        const userRusult = await userCollection.updateOne(useQuery, updateUser)
      }
      res.send(rusult)
    })
    app.post('/riders', async (req, res) => {
      const rider = req.body;
      rider.status = 'pending';
      rider.createdAt = new Date();
      const result = await ridersCollection.insertOne(rider);
      res.send(result)
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('zap shift')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})