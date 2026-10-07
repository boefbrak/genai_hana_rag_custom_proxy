const cds = require('@sap/cds');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

cds.on('bootstrap', (app) => {
  // Enable CORS for cross-origin requests from the UI app
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      const { file } = req;
      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const fileExtension = file.originalname.split('.').pop().toLowerCase();
      const allowedExtensions = ['pdf', 'txt', 'csv'];

      if (!allowedExtensions.includes(fileExtension)) {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF, TXT, or CSV.' });
      }

      const { processUpload } = require('./lib/upload-processor');
      const result = await processUpload({
        fileName: file.originalname,
        fileType: fileExtension,
        fileSize: file.size,
        buffer: file.buffer
      });

      res.status(201).json(result);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

module.exports = cds.server;
