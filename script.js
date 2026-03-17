// Compat版（HTMLのscriptタグ）を使用するため、import文は不要です。

// ==========================================
// 🚨 TODO: ユーザー様へのお願い 🚨
// 以下の firebaseConfig の中身を、ご自身のFirebaseプロジェクトの設定に書き換えてください。
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCxXg2uRleCyO42TKxykDOK9Ohq2esHJLU",
    authDomain: "mol-puzzle.firebaseapp.com",
    projectId: "mol-puzzle",
    storageBucket: "mol-puzzle.firebasestorage.app",
    messagingSenderId: "514107108723",
    appId: "1:514107108723:web:e8fabcb9032edb607f6906"
};

// Firebaseの初期化（設定がYOUR_のままだとエラーになるためtry-catchで囲んでおきます）
let db = null;
try {
    // APIキーが初期値以外なら正しく初期化する
    if (firebaseConfig.apiKey && firebaseConfig.apiKey.length > 20) {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
    }
} catch (e) {
    console.error("Firebase Initialization Error:", e);
}

document.addEventListener('DOMContentLoaded', () => {
    // === DOM要素の取得 ===
    const titleScreen = document.getElementById('title-screen');
    const playScreen = document.getElementById('play-screen');
    const resultScreen = document.getElementById('result-screen');

    const startBtn = document.getElementById('start-btn');
    const retryBtn = document.getElementById('retry-btn');
    const titleBtn = document.getElementById('title-btn'); // 修正: shareBtn -> titleBtn
    const reviewBtn = document.getElementById('review-btn'); // 追加: 復習ボタン

    const scoreEl = document.getElementById('score');
    const timeEl = document.getElementById('time');
    const questionEl = document.getElementById('question');
    const optionsContainer = document.getElementById('options');
    const finalScoreEl = document.getElementById('final-score');
    const rankEl = document.getElementById('rank');
    const rankMessageEl = document.getElementById('rank-message');
    const comboDisplay = document.getElementById('combo-display');
    const rankingList = document.getElementById('ranking-list'); // 追加: ランキングリスト

    // ヒント機能要素
    const hintBtn = document.getElementById('hint-btn');
    const hintDisplay = document.getElementById('hint-display');

    // === ゲーム状態変数 ===
    let score = 0;
    let timeLeft = 60;
    let targetTimeLeft = 60; // 表示用と管理用の時間を分ける(ペナルティ減算なども加味した内部時間)
    let startTime = 0;
    let penaltyTime = 0; // ペナルティで削られた総秒数
    let timerId = null;
    let combo = 0;

    // === 復習モード用変数 ===
    let isReviewMode = false;
    let wrongQuestions = [];
    let currentReviewIndex = 0;
    let currentQuestionData = null;
    let currentHintStage = 0; // 追加: 0=未クリック, 1=1回目(原子量)クリック済, 2=2回目(分子/式量)クリック済

    // === 音響エフェクト（Web Audio API） ===
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();

    function playSound(type) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (type === 'correct') {
            // より爽快感のあるアルペジオ音（ピロリロリン♪）
            const osc2 = audioCtx.createOscillator();
            const osc3 = audioCtx.createOscillator();

            osc.type = 'sine';
            osc2.type = 'sine';
            osc3.type = 'sine';

            osc.connect(gainNode);
            osc2.connect(gainNode);
            osc3.connect(gainNode);

            // 和音とアルペジオでクリアな響きを
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            osc.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.05); // E6

            osc2.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.05); // C6
            osc2.frequency.setValueAtTime(1760, audioCtx.currentTime + 0.1); // A6

            osc3.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.1); // E6
            osc3.frequency.setValueAtTime(2093, audioCtx.currentTime + 0.15); // C7

            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
            osc2.start(); osc2.stop(audioCtx.currentTime + 0.3);
            osc3.start(); osc3.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'wrong') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(250, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2); // ブブー音
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        } else if (type === 'start') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        }
    }

    // === モード遷移関数 ===
    function showScreen(screenToShow) {
        [titleScreen, playScreen, resultScreen].forEach(screen => {
            if (screen === screenToShow) {
                screen.classList.remove('hidden');
                screen.classList.add('active');
            } else {
                screen.classList.remove('active');
                screen.classList.add('hidden');
            }
        });
    }

    // === タイマー管理 ===
    function startTimer() {
        if (isReviewMode) return; // 復習モードではタイマーを動かさない

        // 実際のミリ秒時刻を記録
        startTime = Date.now();
        penaltyTime = 0;
        timeLeft = 60;
        timeEl.textContent = timeLeft;

        timerId = setInterval(() => {
            // 現在の時刻と開始時刻の差分から経過時間を出し、ペナルティ分も差し引いて残り時間を正確に計算
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            timeLeft = Math.max(0, 60 - elapsed - penaltyTime);

            timeEl.textContent = timeLeft;

            if (timeLeft <= 0) {
                endGame();
            }
        }, 100); // 1秒ではなく、0.1秒ごとに差分をチェックしてズレをなくす
    }

    function stopTimer() {
        if (timerId) clearInterval(timerId);
    }

    // === ランキング機能（Firebase連携） ===
    async function loadRanking() {
        rankingList.innerHTML = '<li>Loading...</li>';

        if (!db) {
            rankingList.innerHTML = '<li style="color:#7f8c8d; font-size:0.9em; text-align:center;">APIキーを設定すると<br>ランキングが表示されます</li>';
            return;
        }

        try {
            const querySnapshot = await db.collection("scores").orderBy("score", "desc").limit(5).get();

            rankingList.innerHTML = '';
            if (querySnapshot.empty) {
                rankingList.innerHTML = '<li>まだスコアがありません</li>';
                return;
            }

            let rankNum = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const li = document.createElement('li');
                li.innerHTML = `
                    <span style="width:20px; font-weight:900;">${rankNum}</span>
                    <span class="rank-name">${data.name || 'No Name'}</span>
                    <span class="rank-score">${data.score}pt</span>
                `;
                rankingList.appendChild(li);
                rankNum++;
            });
        } catch (e) {
            console.error("Error loading ranking: ", e);
            rankingList.innerHTML = '<li>読込エラー</li>';
        }
    }

    async function saveScore(finalScore) {
        if (!db || finalScore <= 0) return; // DB未設定または0点なら保存しない

        // 簡易的な名前入力プロンプト
        const playerName = prompt(`今回のスコアは ${finalScore} 点でした！\nランキングに登録する名前を入力してください（未記入でキャンセル）`);
        if (!playerName || playerName.trim() === "") return;

        try {
            // "scores" コレクションへ追加
            await db.collection("scores").add({
                name: playerName.slice(0, 10), // 名前は最大10文字に制限
                score: finalScore,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('スコアを登録しました！タイトル画面で確認できます。');
            loadRanking(); // ランキング再取得
        } catch (e) {
            console.error("Error saving score: ", e);
            alert('スコアの保存に失敗しました。');
        }
    }

    // === ゲームフロー関数 ===
    function initGame() {
        playSound('start');
        score = 0;
        combo = 0;
        isReviewMode = false;
        wrongQuestions = [];
        scoreEl.textContent = score;
        timeEl.textContent = 60;
        document.querySelector('.score-display').childNodes[0].nodeValue = "SCORE: ";
        document.querySelector('.time-display').childNodes[0].nodeValue = "TIME: ";
        comboDisplay.classList.add('hidden');
        showScreen(playScreen);
        startTimer();
        generateQuestion();
    }

    function endGame() {
        stopTimer();
        showScreen(resultScreen);
        finalScoreEl.textContent = score;

        // 簡易的なランク判定
        let rank, message;
        if (score >= 2000) { rank = 'S'; message = '神レベルのモルマスター！'; }
        else if (score >= 1000) { rank = 'A'; message = '天才的モルマスター！'; }
        else if (score >= 500) { rank = 'B'; message = 'なかなかのモル使い！'; }
        else { rank = 'C'; message = 'まだまだ伸びしろあり！'; }

        rankEl.textContent = rank;
        rankMessageEl.textContent = message;

        // --- 復習ボタンの表示制御 ---
        if (wrongQuestions.length > 0) {
            reviewBtn.classList.remove('hidden');
        } else {
            reviewBtn.classList.add('hidden');
        }

        // 終了時にスコア保存を試みる（非同期）
        setTimeout(() => {
            saveScore(score);
        }, 500); // 画面が切り替わってからプロンプトを出すための遅延
    }

    // === データ定義 ===
    // 構成元素と原子量
    const atomicWeights = {
        H: 1.0, C: 12, N: 14, O: 16, Na: 23, Cl: 35.5
    };

    const substances = [
        { name: "水(H₂O)", mass: 18.0, isGas: false, hint: "H = 1.0, O = 16", hint2Type: "分子量" },
        { name: "二酸化炭素(CO₂)", mass: 44.0, isGas: true, hint: "C = 12, O = 16", hint2Type: "分子量" },
        { name: "酸素(O₂)", mass: 32.0, isGas: true, hint: "O = 16", hint2Type: "分子量" },
        { name: "水素(H₂)", mass: 2.0, isGas: true, hint: "H = 1.0", hint2Type: "分子量" },
        { name: "窒素(N₂)", mass: 28.0, isGas: true, hint: "N = 14", hint2Type: "分子量" },
        { name: "炭素(C)", mass: 12.0, isGas: false, hint: "C = 12", hint2Type: "式量" },
        { name: "塩化ナトリウム(NaCl)", mass: 58.5, isGas: false, hint: "Na = 23, Cl = 35.5", hint2Type: "式量" },
        { name: "アンモニア(NH₃)", mass: 17.0, isGas: true, hint: "N = 14, H = 1.0", hint2Type: "分子量" },
        { name: "メタン(CH₄)", mass: 16.0, isGas: true, hint: "C = 12, H = 1.0", hint2Type: "分子量" }
    ];

    const molPatterns = [0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0];

    function formatParticles(multiplier) {
        let val = multiplier * 6.0;
        let exponent = 23;

        if (Math.abs(val) < 0.000001) return "0 個";

        while (val >= 10) {
            val /= 10;
            exponent++;
        }
        while (val < 1 && val > 0) {
            val *= 10;
            exponent--;
        }

        const superscriptMap = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻'
        };
        const expStr = exponent.toString().split('').map(char => superscriptMap[char] || char).join('');

        // 表記例: 3.0×10²³個
        return `${val.toFixed(1)}×10${expStr} 個`;
    }

    // === 本格的な問題生成ロジック ===
    function generateQuestion() {
        // ヒントのリセット
        currentHintStage = 0;
        hintBtn.innerHTML = '💡 原子量を見る<br><span style="font-size: 0.8em;">-10pt</span>';
        hintBtn.disabled = false;
        hintDisplay.classList.add('hidden');
        if (isReviewMode) {
            // 復習モード中はヒントボタンそのものを隠す（ペナルティの概念がないため）
            hintBtn.parentElement.classList.add('hidden');
        } else {
            hintBtn.parentElement.classList.remove('hidden');
        }

        const sub = substances[Math.floor(Math.random() * substances.length)];
        const mol = molPatterns[Math.floor(Math.random() * molPatterns.length)];

        const types = ['mol', 'g', 'particles'];
        if (sub.isGas) types.push('L');

        // 問題として提示する単位
        const questionType = types[Math.floor(Math.random() * types.length)];
        // 答えとして選ばせる単位
        const answerTypes = types.filter(t => t !== questionType);
        const answerType = answerTypes[Math.floor(Math.random() * answerTypes.length)];

        const formats = {
            'mol': (m) => `${m} mol`,
            'g': (m) => `${parseFloat((m * sub.mass).toFixed(2))} g`,
            'L': (m) => `${parseFloat((m * 22.4).toFixed(2))} L`,
            'particles': (m) => formatParticles(m)
        };

        // お題の表示を変更（明示的にdivで囲んで改行させる）
        questionEl.innerHTML = `
            <div>${formats[questionType](mol)}</div>
            <div style="font-size: 1.2rem; color: var(--text-main); font-weight: normal; margin-top: 0.2rem;">${sub.name}</div>
        `;

        const options = [{ text: formats[answerType](mol), isCorrect: true }];

        let wrongMols = [];
        let attempts = 0;

        // ダミー選択肢を3つ生成
        while (wrongMols.length < 3 && attempts < 100) {
            let wMol = molPatterns[Math.floor(Math.random() * molPatterns.length)];

            // モル数が同じまたは似ている場合は、ありがちな計算ミスパターンを生成
            if (wMol === mol || Math.random() > 0.5) {
                const mistakes = [10, 0.1, 2, 0.5, 22.4, 6.0, 18.0, sub.mass, 1 / sub.mass];
                wMol = mol * mistakes[Math.floor(Math.random() * mistakes.length)];
                // 計算ミスによって極端に長い小数になるのを防ぐ
                wMol = parseFloat(wMol.toFixed(4));
            }

            const wrongText = formats[answerType](wMol);
            const isDuplicate = options.some(opt => opt.text === wrongText) || wrongMols.some(wm => formats[answerType](wm) === wrongText);

            if (!isDuplicate && wMol > 0 && !wrongText.includes("NaN")) {
                wrongMols.push(wMol);
            }
            attempts++;
        }

        wrongMols.forEach(wMol => {
            options.push({ text: formats[answerType](wMol), isCorrect: false });
        });

        // 選択肢をシャッフル
        options.sort(() => Math.random() - 0.5);

        // --- ヒント表示機能のセット ---
        // 毎回新しくイベントを付け直すのは非効率なので、ここではデータの保持のみ行う
        currentQuestionData = {
            html: questionEl.innerHTML,
            options: [...options], // シャッフル後の選択肢配列をコピー
            hintText: sub.hint, // 物質ごとのヒントテキストを保持
            hint2Text: `${sub.hint2Type}: ${sub.mass}`, // 2段階目のヒント（分子量/式量: 数値）
            hint2Label: sub.hint2Type // ボタン表記変更用
        };

        // 選択肢のボタンを生成する際に、正解かどうかをdatasetに持たせる
        optionsContainer.innerHTML = '';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = opt.text;
            if (opt.isCorrect) btn.dataset.correct = 'true';
            btn.onclick = () => handleAnswer(btn, opt.isCorrect);
            optionsContainer.appendChild(btn);
        });
    }

    function handleAnswer(btn, isCorrect) {
        // 連打防止
        optionsContainer.style.pointerEvents = 'none';

        if (isCorrect) {
            playSound('correct');
            btn.classList.add('correct');

            if (isReviewMode) {
                // =============== 復習モード正解時 ===============
                setTimeout(() => {
                    optionsContainer.style.pointerEvents = 'auto';
                    currentReviewIndex++;
                    showReviewQuestion(); // 次の復習問題へ
                }, 500); // 復習モードはゆっくりめに次へ
            } else {
                // =============== 通常ゲーム正解時 ===============
                combo++;
                // コンボボーナス（例：基本100点 ＋ コンボ数×20点）
                const earned = 100 + (combo * 20);
                score += earned;
                scoreEl.textContent = score;

                if (combo >= 2) {
                    comboDisplay.innerHTML = `<span style="font-size:1.2em;">${combo}</span> COMBO!`;
                    comboDisplay.classList.remove('hidden');
                    // アニメーション再トリガーのための工夫
                    comboDisplay.style.animation = 'none';
                    comboDisplay.offsetHeight; /* trigger reflow */
                    comboDisplay.style.animation = null;
                }

                setTimeout(() => {
                    optionsContainer.style.pointerEvents = 'auto';
                    generateQuestion();
                }, 300); // すぐ次の問題へ
            }

        } else {
            playSound('wrong');
            btn.classList.add('wrong');

            // 不正解のとき、どれが正解だったかを緑色でハイライトする
            const allBtns = optionsContainer.querySelectorAll('.option-btn');
            allBtns.forEach(b => {
                if (b.dataset.correct === 'true') {
                    b.classList.add('correct');
                }
            });

            if (isReviewMode) {
                // =============== 復習モード不正解時 ===============
                setTimeout(() => {
                    optionsContainer.style.pointerEvents = 'auto';
                    // 同じ問題をもう一度出し直す
                    showReviewQuestion();
                }, 1000);
            } else {
                // =============== 通常ゲーム不正解時 ===============
                // 間違えた問題を保存する
                wrongQuestions.push(currentQuestionData);

                combo = 0;
                comboDisplay.classList.add('hidden');
                // ペナルティ: スコア減点（スコア減算は残し、タイムロスのみ廃止とした場合はpenaltyTimeは操作しない）
                // ※もし以前タイムロス(-3秒)を戻したい場合は penaltyTime += 3; を追加します。
                score = Math.max(0, score - 50);
                scoreEl.textContent = score;

                setTimeout(() => {
                    optionsContainer.style.pointerEvents = 'auto';
                    generateQuestion();
                }, 800); // 間違えた時はどこが正解か見せるために少し長く止める（0.8秒）
            }
        }
    }

    // === 復習モード関連関数 ===
    function initReviewMode() {
        isReviewMode = true;
        currentReviewIndex = 0;
        showScreen(playScreen);

        // ヘッダーの表示を復習モード用に変更
        document.querySelector('.score-display').childNodes[0].nodeValue = "残問題: ";
        scoreEl.textContent = wrongQuestions.length;
        document.querySelector('.time-display').childNodes[0].nodeValue = "MODE: ";
        timeEl.textContent = "復習";

        comboDisplay.classList.add('hidden');
        showReviewQuestion();
    }

    function showReviewQuestion() {
        if (currentReviewIndex >= wrongQuestions.length) {
            // 復習完了
            alert("すべての復習が完了しました！よく頑張りました✨");
            // 完了したため間違えリストをクリア
            wrongQuestions = [];
            reviewBtn.classList.add('hidden');
            showScreen(resultScreen);
            return;
        }

        // ヘッダーの残問題数を更新
        scoreEl.textContent = wrongQuestions.length - currentReviewIndex;

        const qData = wrongQuestions[currentReviewIndex];
        questionEl.innerHTML = qData.html;

        // 復習モード時はヒント領域を隠す
        hintBtn.parentElement.classList.add('hidden');

        optionsContainer.innerHTML = '';

        // 毎回選択肢の場所をシャッフルし直す
        const opts = [...qData.options].sort(() => Math.random() - 0.5);

        opts.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = opt.text;
            if (opt.isCorrect) btn.dataset.correct = 'true';
            btn.onclick = () => handleAnswer(btn, opt.isCorrect);
            optionsContainer.appendChild(btn);
        });
    }

    // === イベントリスナー紐付け ===
    startBtn.addEventListener('click', initGame);
    retryBtn.addEventListener('click', initGame);
    reviewBtn.addEventListener('click', initReviewMode);

    // ヒントボタン挙動 (2段階)
    hintBtn.addEventListener('click', () => {
        if (hintBtn.disabled || isReviewMode) return;

        if (currentHintStage === 0) {
            // --- 1段階目（原子量表示） ---
            score = Math.max(0, score - 10);
            scoreEl.textContent = score;

            // ヒントの表示（改行対応）
            hintDisplay.innerHTML = currentQuestionData.hintText.replace(/, /g, '<br>');
            hintDisplay.classList.remove('hidden');

            // ボタンを2段階目に変更
            currentHintStage = 1;
            hintBtn.innerHTML = `💡 ${currentQuestionData.hint2Label}を見る<br><span style="font-size: 0.8em;">-50pt</span>`;

        } else if (currentHintStage === 1) {
            // --- 2段階目（分子量/式量表示） ---
            score = Math.max(0, score - 50);
            scoreEl.textContent = score;

            // ヒント内容に追記（原子量改行版 + 区切り線 + 分子量/式量）
            const baseHint = currentQuestionData.hintText.replace(/, /g, '<br>');
            hintDisplay.innerHTML = `${baseHint}<hr style="margin: 4px 0; border: 1px dashed var(--text-main);">${currentQuestionData.hint2Text}`;

            // これ以上押せなくする
            currentHintStage = 2;
            hintBtn.disabled = true;
        }
    });

    titleBtn.addEventListener('click', () => {
        showScreen(titleScreen);
        loadRanking(); // タイトルに戻るたびにランキング更新
    });

    // 初期状態セット
    showScreen(titleScreen);
    loadRanking(); // 起動時にランキング取得
});
