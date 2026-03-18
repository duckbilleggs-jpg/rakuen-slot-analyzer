const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'machine_db.json');

function loadDB() {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// ハードコーディングされていた判定ロジック群
function migrateData() {
    const db = loadDB();
    let updatedCount = 0;

    for (const [modelName, data] of Object.entries(db)) {
        let type = 'AT';
        let hitCols = ['BB', 'RB', 'ART'];
        let probThresholds = { s6: 250, s5: 270, s4: 300 }; // デフォルト

        // --- Aタイプ (BB+RB) ---
        if (modelName.includes('ジャグラー')) {
            type = 'A';
            hitCols = ['BB', 'RB'];
            if (modelName.includes('マイ')) {
                probThresholds = { s6: 114, s5: 120, s4: 128 };
            } else if (modelName.includes('ハッピー')) {
                probThresholds = { s6: 121, s5: 128, s4: 135 };
            } else if (modelName.includes('ファンキー')) {
                probThresholds = { s6: 119, s5: 125, s4: 137 };
            } else if (modelName.includes('ガールズ')) {
                probThresholds = { s6: 119, s5: 126, s4: 133 };
            } else {
                probThresholds = { s6: 121, s5: 127, s4: 135 }; // アイムなど
            }
        } 
        else if (modelName.includes('ハナハナ')) {
            type = 'A';
            hitCols = ['BB', 'RB'];
            if (modelName.includes('ドラゴン')) {
                probThresholds = { s6: 133, s5: 141, s4: 151 };
            } else if (modelName.includes('キング')) {
                probThresholds = { s6: 136, s5: 145, s4: 156 };
            } else {
                probThresholds = { s6: 138, s5: 147, s4: 158 };
            }
        }
        else if (modelName.includes('ニューパルサー')) {
            type = 'A';
            hitCols = ['BB', 'RB'];
            probThresholds = { s6: 130, s5: 135, s4: 145 };
        }
        else if (modelName.includes('沖ドキ')) {
            type = 'AT';
            hitCols = ['BB', 'RB']; // 沖ドキは基本的に擬似ボ合算
            probThresholds = { s6: 230, s5: 250, s4: 270 };
        }

        // --- スマスロ・AT機個別 ---
        else if (modelName.includes('北斗の拳')) {
            type = 'AT';
            hitCols = ['BB'];
            probThresholds = { s6: 235, s5: 250, s4: 280 };
        }
        else if (modelName.includes('ヴァルヴレイヴ') || modelName.includes('カバネリ')) {
            type = 'AT';
            hitCols = ['BB', 'ART'];
            probThresholds = { s6: 220, s5: 240, s4: 270 };
        }
        else if (modelName.includes('番長')) {
            type = 'AT';
            hitCols = ['BB', 'ART'];
            probThresholds = { s6: 220, s5: 240, s4: 260 };
        }
        else if (modelName.includes('からくりサーカス')) {
            type = 'AT';
            hitCols = ['ART']; // からくりはAT直撃等を考慮する場合があるが一旦ARTのみ
            probThresholds = { s6: 280, s5: 320, s4: 360 }; // 仮の近似値
        }
        else if (modelName.includes('モンキーターン')) {
            type = 'AT';
            hitCols = ['ART'];
            probThresholds = { s6: 220, s5: 240, s4: 260 };
        }
        else if (modelName.includes('ゴッドイーター')) {
            type = 'AT';
            hitCols = ['ART'];
            probThresholds = { s6: 260, s5: 280, s4: 300 };
        }
        else {
            // 特に指定のない機種 (既存通りデフォルト)
            type = 'AT';
            hitCols = ['BB', 'RB', 'ART'];
            probThresholds = { s6: 200, s5: 250, s4: 300 };
        }

        db[modelName].type = type;
        db[modelName].hitCols = hitCols;
        db[modelName].probThresholds = probThresholds;
        updatedCount++;
    }

    saveDB(db);
    console.log(`Migration completed. Updated ${updatedCount} machines.`);
}

migrateData();
