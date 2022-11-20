const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const colors = require("colors");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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

app.get("/bookings", async (req, res) => {
  const email = req.query.email;
  const query = { email };
  const result = await bookingsCollection.find(query).toArray();

  res.send(result);
});

// Send Bookin data to database

app.post("/bookings", async (req, res) => {
  try {
    const booking = req.body;
    console.log(booking);
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

app.get("/", async (req, res) => {
  res.send("Doctors portal server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
