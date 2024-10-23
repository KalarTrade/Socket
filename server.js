import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import twilio from "twilio";
import bodyParser from "body-parser";

// Create the equivalent of __dirname in ES module mode
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// Twilio credentials
const accountSid = 'AC7516ab8434448444d62df6e471c5befe'; // Your Account SID
const authToken = 'b0284969f994baf531191a3e6935ee56'; // Your Auth Token
const twilioClient = twilio(accountSid, authToken);
const twilioServiceSid = 'VAd15a22aacc90110556b7fb57e5cfeaa8'; // Your Twilio Verify Service SID

// Middleware
app.use(bodyParser.json());
app.use(express.static("public")); // Serve your static files

// Game State Variables
let currentBets = []; // Stores the current bets for the round
let roundNumber = 1; // Tracks round numbers
let isBettingOpen = true;
let result = ""; // Stores the result of the coin toss
let history = []; // Stores bet history
let usersWhoBet = new Set(); // Tracks users who have placed bets in the current round
let users = {}; // In-memory storage for users (for demo purposes)

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

// Route for sending OTP
app.post("/send-otp", async (req, res) => {
  const { phoneNumber } = req.body;

  // Ensure the phone number is a 10-digit number
  if (!/^\d{10}$/.test(phoneNumber)) {
    return res.status(400).send("Invalid phone number format. Please enter a 10-digit number.");
  }

  // Prepend the country code
  const fullPhoneNumber = `+91${phoneNumber}`;

  try {
    await twilioClient.verify.v2.services(twilioServiceSid)
      .verifications
      .create({ to: fullPhoneNumber, channel: 'sms' });

    users[fullPhoneNumber] = {}; // Initialize user data
    res.status(200).send("OTP sent successfully.");
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).send("Error sending OTP.");
  }
});

// Route for verifying OTP
app.post("/verify-otp", async (req, res) => {
  const { phoneNumber, otp } = req.body;

  // Prepend the country code to the phone number
  const fullPhoneNumber = `+91${phoneNumber}`;

  try {
    const verificationCheck = await twilioClient.verify.v2.services(twilioServiceSid)
      .verificationChecks
      .create({ to: fullPhoneNumber, code: otp });

    if (verificationCheck.status === 'approved') {
      users[fullPhoneNumber].verified = true; // Mark user as verified
      res.status(200).send("OTP verified successfully.");
    } else {
      res.status(400).send("Invalid OTP.");
    }
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).send("Error verifying OTP.");
  }
});

// Function to start a new round
function startRound() {
  isBettingOpen = true;
  currentBets = [];
  result = "";
  usersWhoBet.clear(); // Clear the set of users who placed bets in the last round

  io.emit("new round", {
    roundNumber,
    isBettingOpen,
  });

  console.log(`Round ${roundNumber} has started. Betting is now open.`);

  // Start a 10-second betting timer
  let countdown = 10;
  const timer = setInterval(() => {
    countdown--;
    io.emit("timer", countdown);

    if (countdown === 0) {
      clearInterval(timer);
      closeBetting();
    }
  }, 1000);
}

// Function to close betting and resolve the round
function closeBetting() {
  isBettingOpen = false;
  io.emit("betting closed");

  console.log("Betting is closed. Calculating result...");

  // Simulate coin toss
  result = Math.random() < 0.5 ? "heads" : "tails";
  io.emit("round result", result);

  // Process bets and store in history
  currentBets.forEach((bet) => {
    const payout = bet.choice === result ? bet.amount * 2 : 0;
    history.push({
      user: bet.user,
      round: roundNumber,
      bet: bet.choice,
      amount: bet.amount,
      result,
      payout,
    });
  });

  // Broadcast the updated bet history to all clients
  io.emit("update history", history);

  console.log(`Coin toss result: ${result}.`);

  // After 5 seconds, start a new round
  setTimeout(() => {
    roundNumber++;
    startRound();
  }, 5000);
}

// Handle connections
io.on("connection", (socket) => {
  console.log(`User ${socket.id} connected.`);

  // Send the current game state to the newly connected client
  socket.emit("game state", {
    roundNumber,
    isBettingOpen,
    result,
    history,
  });

  // Handle bet placement
  socket.on("place bet", (bet) => {
    if (isBettingOpen) {
      // Prevent the user from betting multiple times in a single round
      if (!usersWhoBet.has(socket.id)) {
        usersWhoBet.add(socket.id); // Mark the user as having placed a bet
        currentBets.push({
          user: socket.id,
          choice: bet.choice,
          amount: bet.amount,
        });
        console.log(
          `User ${socket.id} placed a bet: ${bet.choice} - ${bet.amount}`
        );
      } else {
        socket.emit(
          "bet rejected",
          "You have already placed a bet for this round."
        );
      }
    } else {
      socket.emit("bet rejected", "Betting is closed for this round.");
    }
  });

  socket.on("disconnect", () => {
    console.log(`User ${socket.id} disconnected.`);
  });
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
  startRound();
});
