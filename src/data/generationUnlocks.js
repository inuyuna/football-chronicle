// 周回を重ねるごとに1つずつ解放される機能。
//
// 方針（本人指示 2026-11-23）:
//   「2週目以降で増える機能は1周に1つにして、説明とフレーバーテキストを
//     ちゃんと出すように」
//   「子弟継承は……2週目の人生でいきなり解放されるより、3週目から」
//
// 以前は2周目で全部まとめて解放されていたため、
// 何が増えたのか分からないまま画面だけ複雑になっていた。
//
// flavor は「なぜ今それができるようになったのか」をタイムリープの文脈で説明する。
// 記憶だけを持って5歳に戻る以上、新しくできることは
// 「前の人生で得た知識が形になった」結果でなければならない（GAME_DESIGN §2）。

/**
 * @typedef {Object} GenerationUnlock
 * @property {string} id       内部キー
 * @property {number} gen      この周回数に達すると解放される（totalGenerations）
 * @property {string} name     機能名
 * @property {string} summary  何ができるようになるか（1行）
 * @property {string} flavor   解放時に出す本文
 * @property {string} icon
 */

/** @type {GenerationUnlock[]} */
export const GENERATION_UNLOCKS = [
  {
    id: 'gear',
    gen: 2,
    name: '道具・自己投資',
    icon: '🛒',
    summary: 'スパイクや栄養、練習器具を自分で買えるようになる',
    flavor:
      '一度目の人生で、何が足りなかったかは分かっている。\n' +
      'すり減ったスパイクのまま走り続けたこと。食事をまともに考えなかったこと。' +
      'どの練習にいくら払う価値があったのか、答えを知っている状態で5歳に戻ってきた。\n' +
      '金はまだ無い。だが、何に使うべきかは分かっている。'
  },
  {
    id: 'protege',
    gen: 3,
    name: '師弟継承',
    icon: '👥',
    summary: '後進を見つけて育てられるようになる。絆が自分の力にも還る',
    flavor:
      '三度目になって、ようやく周りが見えるようになった。\n' +
      '一度目は自分のことで精一杯だった。二度目は追い抜くことしか考えていなかった。\n' +
      'だが同じ時間を何度も繰り返していると、隣で伸び悩んでいる選手が、' +
      'どこで躓いているのかが手に取るように分かってしまう。\n' +
      '教えることは、自分の技術を言葉にすることでもある。'
  },
  {
    id: 'charm',
    gen: 4,
    name: '絆のお守り',
    icon: '🏅',
    summary: '人生の出来事で得た品を身につけ、効果を受けられる',
    flavor:
      'ポケットに入れていた、何でもない物。\n' +
      '誰かにもらったキーホルダー、初めて勝った日のメダル、' +
      '何度目かの人生で見つけた小さな石。\n' +
      'それ自体に力があるわけではない。ただ、触れると思い出す。' +
      'どんな顔で誰が渡してくれたのかを。'
  },
  {
    id: 'trait',
    gen: 5,
    name: 'ハイブリッド特性',
    icon: '⚡',
    summary: '複数ポジションの感覚を同時に宿せるようになる',
    flavor:
      '五度の人生で、いくつものポジションを経験してきた。\n' +
      'ゴール前の嗅覚。中盤で全体を見る目。最終ラインで時間を作る我慢。\n' +
      'それぞれ別の競技のようだったものが、ある日ひとつに繋がった。\n' +
      '今はもう、どの位置に立っても、他の位置から見た景色が同時に見えている。'
  },
  {
    id: 'hobby',
    gen: 6,
    name: '趣味・教養',
    icon: '📚',
    summary: 'サッカー以外のことに時間を使い、別方向から自分を伸ばす',
    flavor:
      'ボールだけを蹴り続けた人生を、もう何度か終えてきた。\n' +
      'そのたびに気づく。伸び悩んだ時期に効いたのは、' +
      '練習量ではなく、まったく関係のないところで得た何かだった。\n' +
      '本を読む。音楽を聴く。知らない街を歩く。\n' +
      'それらは遠回りに見えて、結局いちばん速い道だったりする。'
  },
  {
    id: 'rival_coop',
    gen: 7,
    name: '宿敵との共闘',
    icon: '⚔️',
    summary: '倒してきた宿敵と、肩を並べて戦えるようになる',
    flavor:
      '何度も叩きのめされ、何度も叩きのめしてきた相手がいる。\n' +
      '向こうは覚えていない。毎回、初めて会う顔をしている。\n' +
      'だがこちらは知っている。あの男がどこで熱くなり、どこで折れるか。' +
      'そして――どうすれば味方として最高に機能するかも。'
    },
  {
    id: 'brand',
    gen: 8,
    name: 'シグネチャーブランド',
    icon: '👟',
    summary: '自分の名を冠した商品を展開し、資金とファンを生む',
    flavor:
      '八度目の人生で、ようやく名前に値段がつくようになった。\n' +
      '最初の人生では、自分の名前が商品になるなどと考えたこともなかった。\n' +
      'スパイクに刻まれた文字を見ても、まだ実感はない。' +
      'ただ、これで次の人生の準備ができる。'
  }
];

/** 周回数に対して解放されている機能 id の集合を返す */
export function unlockedFeatureIds(totalGenerations, ascensionCount = 0) {
  const gen = Math.max(1, totalGenerations || 1);
  const set = new Set();
  for (const u of GENERATION_UNLOCKS) {
    // 上位転生を1度でも経ていれば、周回数に関わらず全部開ける
    if (ascensionCount >= 1 || gen >= u.gen) set.add(u.id);
  }
  return set;
}

/** その機能が解放されているか */
export function isFeatureUnlocked(id, totalGenerations, ascensionCount = 0) {
  const u = GENERATION_UNLOCKS.find((x) => x.id === id);
  if (!u) return true;
  if (ascensionCount >= 1) return true;
  return (totalGenerations || 1) >= u.gen;
}

/**
 * 前回の周回数から今回へ上がったときに、新しく解放された機能を返す。
 * 解放モーダルを出すのに使う。
 */
export function newlyUnlocked(prevGen, nextGen, ascensionCount = 0) {
  if (ascensionCount >= 1) return [];
  return GENERATION_UNLOCKS.filter((u) => u.gen > (prevGen || 1) && u.gen <= (nextGen || 1));
}
