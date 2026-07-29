require('dotenv').config();
const app = require('./app');
const { connectDatabase } = require('./config/db');

const port = Number(process.env.PORT || 5000);

connectDatabase()
  .then(() => app.listen(port, () => console.log('API gateway listening on port ' + port)))
  .catch((error) => { console.error('Startup failed:', error.message); process.exit(1); });
