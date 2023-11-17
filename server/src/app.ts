import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./type/server";
import { Rooms, Users } from "./type/session";
import { OpenAI } from "openai";
import { CTSEndData, STCStartData } from "./type/data";
import e from "cors";

dotenv.config();

const port = process.env.PORT;
const httpServer = createServer();
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: "*",
  },
});

let users: Users = {};
let rooms: Rooms = {};

io.on("connection", (socket) => {
  socket.on("create", (data, callback) => {
    const roomId = socket.id.slice(0, 6);
    users[socket.id] = {
      username: data.username,
      roomId,
      inTest: false,
    };
    rooms[roomId] = { [socket.id]: users[socket.id] };
    socket.join(roomId);
    callback(roomId);
  });

  socket.on("join", (data, callback) => {
    if (data.roomId in rooms) {
      users[socket.id] = {
        username: data.username,
        roomId: data.roomId,
        inTest: false,
      };
      rooms[data.roomId] = {
        ...rooms[data.roomId],
        [socket.id]: users[socket.id],
      };
      socket.join(data.roomId);
      io.to(data.roomId).emit("newPlayer", {
        username: data.username,
        id: socket.id,
      });

      callback(rooms);
    } else callback("error");
  });

  const openai = new OpenAI({
    apiKey: process.env.GTP_APIKEY,
    // organization: process.env.ORGANIZATION_ID,
  });

  const CTSEndData: CTSEndData = {};

  let STCStartData: STCStartData = {
    questions: undefined,
  };

  const createChatCompletion = async (data) => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      // max_tokens: 350,
      messages: [
        {
          role: "system",
          content: `Genere moi 2 question et reponses (4 par questions et une seule est bonne) sur le theme de la technologie d'une difficulte facile, je veux que ce soit en json composer de 2 tableau. 
        le premier tableau compose d'une liste d'objet avec key "questions", chaque objet est compose d'une question ( key "question") de 4 reponses (key "options" ) sans la bonne reponses. les bonne reponses devront etre le second tableau sous forne de liste d'index (key "answers").
        il me faut 2 questions et ne m'envoie que le json sans tes phrases inutile 
        exemple de ma structure :
        {
          questions: [
            {
              question: "",
              options: [...]
            },
            {
              question: "",
              options: [...]
            },
            ...
          ],
          answers: [...]
        }`,
        },
      ],
    });
    const formatResponseText = JSON.parse(response.choices[0].message.content);
    STCStartData = {
      // options: formatResponseText.questions[0].options,
      questions: formatResponseText.questions,
    };
    // CTSEndData = formatResponseText.answers;
    CTSEndData[data.roomId] = {
      ...response,
      response: formatResponseText.answers,
    };
    console.log("response", response);
  };

  socket.on("start", async (dataClient, callback) => {
    const clientRoomId = dataClient.roomId;
    console.log(
      "dataClient.roomId: ",
      dataClient.roomId,
      "Now waiting for OpenAI response"
    );
    if (clientRoomId in rooms) {
      Object.keys(rooms[clientRoomId]).forEach((userId) => {
        rooms[clientRoomId][userId].inTest = true;
      });
      await createChatCompletion(dataClient);
      io.to(clientRoomId).emit("startServer", {
        // roomId: dataclient.roomId,
        // options: STCStartData,
        questions: STCStartData.questions,
      });
    } else callback("error creating chat completion");
  });

  socket.on("end", (dataClient) => {
    const clientRoomId = dataClient.roomId;
    const clientUserId = dataClient.userId;
    console.log("rooms", rooms);
    console.log("dataClient", dataClient);

    if (clientRoomId in rooms) {
      if (clientUserId in rooms[clientRoomId]) {
        rooms[clientRoomId][clientUserId].inTest = false;

        if (
          Object.keys(rooms[clientRoomId]).find(
            (userId) => rooms[clientRoomId][userId].inTest == true
          )
        ) {
          console.log("find users on test");
        } else {
          console.log("send response test");
          io.to(clientRoomId).emit("giveResponseServer", {
            response: CTSEndData[clientRoomId].response,
            // answers: { response: CTSEndData[dataClient.roomId].response },
          });
        }
      }
    }
  });

  socket.on("disconnect", (reason) => {
    if (users[socket.id] && rooms[users[socket.id].roomId] !== undefined) {
      delete rooms[users[socket.id].roomId][socket.id];
    }
    delete users[socket.id];
    console.log(`User ${socket.id} disconnected`);
    console.log(reason);
  });
});
httpServer.listen(port, () => {
  console.log(`Server Socket.io is running at http://localhost:${port}`);
});
