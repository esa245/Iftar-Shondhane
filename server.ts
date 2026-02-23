import express, { Request } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import session from "express-session";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite Database
let db: Database.Database;
try {
  db = new Database("events.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      district TEXT,
      upazila TEXT,
      village TEXT,
      address TEXT,
      date_range TEXT,
      start_time TEXT,
      iftar_time TEXT,
      contact TEXT,
      description TEXT,
      image_url TEXT,
      lat REAL,
      lng REAL,
      link_url TEXT,
      event_date TEXT,
      event_day TEXT,
      created_at TEXT
    )
  `);
  console.log("SQLite Database initialized successfully.");
} catch (err) {
  console.error("Failed to initialize SQLite database:", err);
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${APP_URL}/auth/google/callback`
);

declare module 'express-session' {
  interface SessionData {
    tokens: any;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    secret: 'iftar-shondhane-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { 
      secure: true, 
      sameSite: 'none',
      httpOnly: true
    }
  }));

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      // Store tokens in session
      (req.session as any).tokens = tokens;

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google Auth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/google/status", (req, res) => {
    res.json({ connected: !!(req.session as any).tokens });
  });

  // Events API
  app.get("/api/events", (req, res) => {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      const events = db.prepare("SELECT * FROM events ORDER BY created_at DESC").all();
      res.json(events);
    } catch (error) {
      console.error("Failed to fetch events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.post("/api/events", (req, res) => {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      const event = req.body;
      console.log("Adding event:", event.name);
      
      const stmt = db.prepare(`
        INSERT INTO events (
          name, type, district, upazila, village, address, date_range, 
          start_time, iftar_time, contact, description, image_url, 
          lat, lng, link_url, event_date, event_day, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        event.name || null, 
        event.type || null, 
        event.district || null, 
        event.upazila || null, 
        event.village || null, 
        event.address || null, 
        event.date_range || null, 
        event.start_time || null, 
        event.iftar_time || null, 
        event.contact || null, 
        event.description || null, 
        event.image_url || null, 
        event.lat ?? null, 
        event.lng ?? null, 
        event.link_url || null, 
        event.event_date || null, 
        event.event_day || null, 
        event.created_at || new Date().toISOString()
      );
      
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
      console.error("Failed to add event to SQLite:", error);
      res.status(500).json({ error: "Failed to add event to database" });
    }
  });

  app.post("/api/events/delete", (req, res) => {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }
    try {
      const { id } = req.body;
      const stmt = db.prepare("DELETE FROM events WHERE id = ?");
      stmt.run(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete event:", error);
      res.status(500).json({ error: "Failed to delete event" });
    }
  });

  app.post("/api/drive/save", async (req, res) => {
    const tokens = (req.session as any).tokens;
    if (!tokens) {
      return res.status(401).json({ error: "Not connected to Google Drive" });
    }

    const { eventData } = req.body;
    
    try {
      oauth2Client.setCredentials(tokens);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // 1. Find or create folder "Iftar Shondhane"
      let folderId;
      const folderResponse = await drive.files.list({
        q: "name = 'Iftar Shondhane' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id)',
      });

      if (folderResponse.data.files && folderResponse.data.files.length > 0) {
        folderId = folderResponse.data.files[0].id;
      } else {
        const folderMetadata = {
          name: 'Iftar Shondhane',
          mimeType: 'application/vnd.google-apps.folder',
        };
        const folder = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id',
        });
        folderId = folder.data.id;
      }

      // 2. Create JSON file for the event
      const fileMetadata = {
        name: `${eventData.name}_${Date.now()}.json`,
        parents: [folderId!],
      };
      const media = {
        mimeType: 'application/json',
        body: JSON.stringify(eventData, null, 2),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });

      res.json({ success: true, fileId: file.data.id });
    } catch (error) {
      console.error("Drive Save Error:", error);
      res.status(500).json({ error: "Failed to save to Drive" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
