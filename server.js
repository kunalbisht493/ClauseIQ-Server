require('dotenv').config();
const app = require('./app');
const { connectDatabase } = require('./config/db');
const { failInterruptedDocuments } = require('./controllers/document.controller');

const port = Number(process.env.PORT || 5000);

connectDatabase()
  .then(async () => {
    // Background processing lives in this process; anything still in flight from a previous run is dead.
    const swept = await failInterruptedDocuments().catch((error) => { console.error('Startup sweep failed:', error.message); return 0; });
    if (swept) console.log(`Marked ${swept} interrupted document(s) as failed`);
    app.listen(port, () => console.log('API gateway listening on port ' + port));
  })
  .catch((error) => { console.error('Startup failed:', error.message); process.exit(1); });
