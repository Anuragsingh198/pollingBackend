const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
  },
});

let students = {}; 
let currentPoll = null; 
let pollTimer = null;
let pollHistory = [];
let messages = []; 

function emitActiveStudents() {
  const studentList = Object.entries(students).map(([id, data]) => ({
    socketId: id,
    name: data.name,
  }));
  io.emit("students:update", studentList);
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("student:join", (name) => {
    students[socket.id] = { name };
    console.log(`Student joined: ${name} (${socket.id})`);
    emitActiveStudents();

    if (currentPoll) {
      socket.emit("poll:question", {
        question: currentPoll.question,
        options: currentPoll.options,
        maxTime: currentPoll.maxTime,
        startTime: currentPoll.startTime,
      });
       emitActiveStudents(); 
    }
  });

  socket.on("teacher:createPoll", ({ question, options, maxTime }) => {
    
    if (currentPoll) {
      socket.emit("poll:error", "A poll is already active.");
      emitActiveStudents(); 
      return;
    }

    currentPoll = {
      question,
      options,
      responses: {},
      maxTime: maxTime || 60, 
      startTime: Date.now(),
    };

    io.emit("poll:question", {
      question,
      options,
      maxTime: currentPoll.maxTime,
      startTime: currentPoll.startTime,
    });

    console.log("New poll created:", question);
     emitActiveStudents(); 
    // Start timer
    pollTimer = setTimeout(() => {
       endPollAndEmitResults();
       emitActiveStudents(); 
    }, currentPoll.maxTime * 1000);

    emitActiveStudents(); 
  });

  socket.emit("chat:history", messages);

  socket.on("chat:message", (msg) => {
    const message = { ...msg, timestamp: Date.now() };
    messages.push(message);

    if (messages.length > 100) {
      messages.shift();
    }

    io.emit("chat:message", message);
    emitActiveStudents(); 
  });

  socket.on("student:submitAnswer", (answer) => {
    if (!currentPoll) {
      socket.emit("poll:error", "No active poll.");
      return;
    }

    currentPoll.responses[socket.id] = answer;
    console.log(`Answer received from ${students[socket.id]?.name}: ${answer}`);

    const counts = {};
    currentPoll.options.forEach((opt) => (counts[opt] = 0));
    Object.values(currentPoll.responses).forEach((ans) => {
      if (counts.hasOwnProperty(ans)) counts[ans]++;
    });

    io.emit("poll:liveResults", {
      question: currentPoll.question,
      counts,
    });

    emitActiveStudents(); 
    if (
      Object.keys(currentPoll.responses).length === Object.keys(students).length
    ) {
      clearTimeout(pollTimer);
      endPollAndEmitResults();
    }
  });

  socket.on("teacher:endPoll", () => {
    if (currentPoll) {
      clearTimeout(pollTimer);
       emitActiveStudents(); 
      endPollAndEmitResults();
    }
  });

  socket.on("teacher:kickStudent", (kickSocketId) => {
    io.to(kickSocketId).emit("student:kicked");
    io.sockets.sockets.get(kickSocketId)?.disconnect();
    delete students[kickSocketId];
    console.log(`Student kicked: ${kickSocketId}`);

    emitActiveStudents(); 
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    delete students[socket.id];
    emitActiveStudents(); 
  });
});

function endPollAndEmitResults() {
  if (!currentPoll) return;

  const counts = {};
  currentPoll.options.forEach((opt) => (counts[opt] = 0));
  Object.values(currentPoll.responses).forEach((ans) => {
    if (counts.hasOwnProperty(ans)) counts[ans]++;
  });

  pollHistory.push({
    question: currentPoll.question,
    options: currentPoll.options,
    counts,
    startTime: currentPoll.startTime,
    endTime: Date.now(),
  });

  io.emit("poll:liveResults", {
    question: currentPoll.question,
    counts,
  });

  io.emit("endPoll", {
    question: currentPoll.question,
    counts,
  });

  console.log("Poll ended. Results emitted and saved to history.");

  currentPoll = null;
  pollTimer = null;

  emitActiveStudents();
} 


app.post("/admin/clear-data", (req, res) => {
  students = {};
  currentPoll = null;
  pollHistory = [];
  messages = [];
  res.send({ success: true, message: "All data cleared." });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
