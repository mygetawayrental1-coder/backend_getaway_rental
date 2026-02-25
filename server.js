require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 MyGatewayRental API Server                            ║
║                                                            ║
║   Server running on: http://localhost:${PORT}                ║
║   Environment: ${process.env.NODE_ENV || 'development'}                            ║
║                                                            ║
║   Endpoints:                                               ║
║   • Auth:          /auth                                   ║
║   • Properties:    /properties                             ║
║   • Inquiries:     /inquiries                              ║
║   • Users:         /users                                  ║
║   • Owners:        /owners                                 ║
║   • Subscriptions: /subscriptions                          ║
║   • Payments:      /payments                               ║
║   • Uploads:       /uploads                          ║
║   • Dashboard:     /dashboard                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
