import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";

// Create the equivalent of __dirname in ES module mode
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// Game State Variables
let currentBets = []; // Stores the current bets for the round
let roundNumber = 1; // Tracks round numbers
let isBettingOpen = true;
let result = ""; // Stores the result of the coin toss
let history = []; // Stores bet history
let usersWhoBet = new Set(); // Tracks users who have placed bets in the current round

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
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
