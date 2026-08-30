const { DynamicLoader } = require('bcdice');

(async () => {
    try {
        console.log('--- BCDice API Test ---');
        const loader = new DynamicLoader();
        
        // 1. SW2.5システムの動的読み込み
        console.log('SwordWorld2_5 をロード中...');
        const GameSystemClass = await loader.dynamicImport('SwordWorld2_5');
        
        // 2. K20コマンドのインスタンス化と実行
        const command = 'K20[12]+10';
        console.log(`コマンド実行: ${command}`);
        
        const system = new GameSystemClass(command);
        const result = system.eval();
        
        // 3. 結果の出力
        if (result) {
            console.log('【実行成功】');
            console.log(`出力テキスト: ${result.text}`);
            console.log(`クリティカル発生: ${result.critical}`);
            console.log(`ファンブル発生: ${result.fumble}`);
        } else {
            console.log('【実行失敗】結果がnullです。');
        }

    } catch (error) {
        console.error('BCDice実行エラー:', error);
    }
})();