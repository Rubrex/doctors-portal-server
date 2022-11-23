const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const colors = require("colors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Middleware function

// Verify JWT Token
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // If no headers sent, status 401
  if (!authHeader) {
    return res.status(401).send("Unauthorized access");
  }

  // Verify Token here
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.SECRET_KEY, function (err, decoded) {
    if (err) {
      return res.status(403).send("Forbidden access");
    }
    // Sending decoded value to req object and access it
    // inside the api function
    req.decoded = decoded;
    next();
  });
};

// Make sure to run this after verifyJWT
// Decoded jwt is dependent for this middleware
const verifyAdmin = async (req, res, next) => {
  const decodedEmail = req.decoded.email;
  const query = { email: decodedEmail };
  const user = await usersCollection.findOne(query);

  if (user?.role !== "admin") {
    return res.status(403).send({ message: "forbidden access" });
  }

  next();
};

// Conntect DB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.f3qt6qk.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log("database connected".yellow.italic);
  } catch (err) {
    console.log(err.name.bgRed, err.message.bold);
  }
}
// Call the server
connectDB();

// Select Database & Collections

const appointmentOptionsCollection = client
  .db("doctorsPortal")
  .collection("appointmentOptions");
const bookingsCollection = client.db("doctorsPortal").collection("bookings");
const usersCollection = client.db("doctorsPortal").collection("users");
const doctorsCollection = client.db("doctorsPortal").collection("doctors");

// Create payment intent
app.post("/create-payment-intent", async (req, res) => {
  const booking = req.body;
  const price = booking.price;
  // Convert cents to poisha
  const amount = price * 100;

  const paymentIntent = await stripe.paymentIntents.create({
    currency: "usd",
    amount: amount,
    payment_method_types: ["card"],
  });

  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

// Generate JWT token for sign in
app.get("/jwt", async (req, res) => {
  const email = req.query.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);

  if (user) {
    const token = jwt.sign({ email: email }, process.env.SECRET_KEY, {
      expiresIn: "10h",
    });

    return res.send({ accessToken: token });
  }

  res.status(403).send({ accessToken: "" });
});

// temporary Update price field in appointmentOptions
// app.get("/addPrice", async (req, res) => {
//   const filter = {};
//   const options = { upsert: true };
//   const updatedDoc = {
//     $set: {
//       price: 77,
//     },
//   };
//   const result = await appointmentOptionsCollection.updateMany(
//     filter,
//     updatedDoc,
//     options
//   );
//   res.send(result);
// });

// Get all the appointment options

app.get("/appointmentOptions", async (req, res) => {
  try {
    const query = {};
    const options = await appointmentOptionsCollection.find(query).toArray();

    // We can use MongoDB Aggregate instead of this madness
    // Getting booking list on that date
    const date = req.query.date;
    const bookingQuery = { appointmentDate: date };
    const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

    // Get slots booked for treatment
    options.forEach((option) => {
      const optionBooked = alreadyBooked.filter((book) => {
        return book.treatment === option.name;
      });

      const bookedSlots = optionBooked.map((book) => book.slot);

      // Get the remaining slots and set it on options
      const remainingSlots = option.slots.filter(
        (slot) => !bookedSlots.includes(slot)
      );
      option.slots = remainingSlots;
    });

    res.send(options);
  } catch (err) {
    console.log(err);
  }
});

// Get Bookins data from search query {?email}

app.get("/bookings", verifyJWT, async (req, res) => {
  const email = req.query.email;
  const decodedEmail = req.decoded.email;
  const query = { email };

  // Verify decoded email with query email
  if (decodedEmail !== email) {
    return res.status(403).send({ message: "forbidden access" });
  }

  const result = await bookingsCollection.find(query).toArray();
  res.send(result);
});

// Get Bookings data by booking id
app.get("/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: ObjectId(id) };
    const booking = await bookingsCollection.findOne(query);

    res.send(booking);
  } catch (err) {
    console.log(err);
  }
});

// Send Bookin data to database

app.post("/bookings", async (req, res) => {
  try {
    const booking = req.body;

    const bookingQuery = {
      email: booking.email,
      treatment: booking.treatment,
      appointmentDate: booking.appointmentDate,
    };

    const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

    if (alreadyBooked.length) {
      const message = `You already booked for this treatment on ${booking.appointmentDate}`;
      return res.send({ acknowledged: false, message });
    }
    const result = await bookingsCollection.insertOne(booking);
    res.send(result);
  } catch (err) {
    console.log(err);
  }
});

// Save users to db
app.post("/users", async (req, res) => {
  const data = req.body;
  const result = await usersCollection.insertOne(data);

  res.send(result);
});

// Get All users in Dashboard [ADMIN only access]
app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
  const query = {};
  const users = await usersCollection.find(query).toArray();

  res.send(users);
});

// Check if the user is Admin
app.get("/users/admin/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);

    res.send({ isAdmin: user?.role === "admin" });
  } catch (err) {
    console.log(err);
  }
});

// Make user admin PUT
app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
  // Second layer of security
  // only admin can request to make admin
  // Moved to verifyAdmin middleware
  const id = req.params.id;
  const filter = { _id: ObjectId(id) };
  const options = { upsert: true };

  const updatedDoc = {
    $set: {
      role: "admin",
    },
  };

  const result = await usersCollection.updateOne(filter, updatedDoc, options);

  res.send(result);
});

app.get("/", async (req, res) => {
  res.send("Doctors portal server is running");
});

// Get Speciality Lists
app.get("/appointmentSpeciality", async (req, res) => {
  const query = {};
  const result = await appointmentOptionsCollection
    .find(query)
    .project({ name: 1 })
    .toArray();

  res.send(result);
});

// Add a new Doctor
app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
  const doctor = req.body;
  const result = await doctorsCollection.insertOne(doctor);

  res.send(result);
});

// Get all Doctors
app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
  const query = {};
  const result = await doctorsCollection.find(query).toArray();
  res.send(result);
});

// Delete Doctor
app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const query = { _id: ObjectId(id) };
  const deleteDoc = await doctorsCollection.deleteOne(query);
  res.send(deleteDoc);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
