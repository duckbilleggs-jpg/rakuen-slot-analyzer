const mongoose = require('mongoose');
const { connectDB, Machine } = require('./database');

async function checkDB() {
  try {
    await connectDB();
    const summary = await Machine.aggregate([
      {
        $group: {
          _id: "$dateKey",
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } }
    ]);
    console.log('=== MongoDB Data Available ===');
    summary.forEach(r => {
      console.log(`${r._id}: ${r.count} machines`);
    });
    console.log(`Total Days: ${summary.length}`);
    process.exit(0);
  } catch(e) {
    console.error("ERROR:", e);
    process.exit(1);
  }
}
checkDB();
