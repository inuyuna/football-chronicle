import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  HelpCircle,
  Dna,
  Flame,
  Swords,
  Users,
  Globe,
  Crown,
  BookOpen,
  Sparkles,
  Award,
  Shield,
  Target,
  Download,
  Upload,
  RotateCcw,
  Trophy,
  Compass,
  MessageSquareQuote,
  Bot,
  GraduationCap,
  Lock,
  TrendingUp,
  Heart,
  CheckSquare
} from 'lucide-react';
import { formatYen, formatNum } from './lib/format.js';
import { calcBulkPurchase, calcBulkSingleResource } from './lib/purchase.js';
import { createSeed, nextRandom } from './lib/rng.js';
import { overCapDiminishing, overCapRatio } from './lib/growth.js';
import { GROWTH_SOFTCAP, POWER_SOFTCAP, softcap } from './lib/softcap.js';
import {
  AFFECTION_MARRY,
  AFFECTION_MAX,
  AFFECTION_PER_DATE,
  ROMANCE_FLAVOR,
  reachedMilestone
} from './data/romanceEvents.js';
import { ENDING_FLAVOR, ascensionFlavor, timeLeapFlavor } from './data/flavorText.js';
import { GENERATION_UNLOCKS, isFeatureUnlocked, newlyUnlocked } from './data/generationUnlocks.js';

const SAVE_KEY = 'football_chronicle_v0_12_save';
const LEGACY_SAVE_KEYS = [
  'football_chronicle_v19_save',
  'football_chronicle_v18_save',
  'football_chronicle_v17_save',
  'football_chronicle_v16_save',
  'football_chronicle_v14_save',
  'football_chronicle_v13_save'
];
const CURRENT_TUTORIAL_VERSION = 12;

// 周回ごとに能力上限の土台が何倍になるか。
//
// もとは 7.0 + (generation-1) * 1.1 の足し算だったが、カテゴリの必要総合力は
// 58→82→125→195→310→500→850 と掛け算で伸びるので、足し算では永久に
// 追いつけなかった（12周してもカテゴリが1段も上がらない）。
// 実測の根拠は docs/BALANCE_LOG.md。
const GENERATION_CAP_GROWTH = 1.6;

// オフライン進行で一度に進める最大ヶ月数。
// 1ヶ月=1ティックなので、1倍速なら約12分ぶん。長く離れても
// 1キャリア（約30年=360ヶ月）を大きく超えて飛ばさないための上限。
const MAX_OFFLINE_MONTHS = 480;

// いまのカテゴリに残れる最低ライン。要求総合力のこの割合を下回ると降格する。
const CONTRACT_KEEP_RATIO = 0.72;
// 最下層（キッズスクール）でも契約がもらえなくなる総合力。ここで現役引退。
const CONTRACT_FLOOR_RATING = 4.5;
// メディア・代表アピールが出るようになるカテゴリ。
// 本人の指摘（2026-11-26）:「一周目からメディア代表アピールあるの変だな。消すか」
// 取材が来るのはプロ契約（J3以上）を結んでから。
const MEDIA_MIN_CAT = 9;
const ALL_DRILL_IDS = ['tech_drill', 'phy_drill', 'tactics_video', 'shoot_drill', 'mental_image'];

// --- ポジション定義（全7種・転生時に選択） ---
const POSITIONS = {
  CF: {
    id: 'CF',
    // チームが決めた得点のうち、自分の得点・アシストになる割合
    statShare: { goal: 0.58, assist: 0.14 },
    name: 'CF（センターFW）',
    role: '絶対的ストライカー',
    capRatio: { tec: 0.95, phy: 1.05, iq: 0.85, sht: 1.3 },
    matchWeight: { shoot: 0.62, mid: 0.25, def: 0.13 },
    desc: '決定力上限が全POS最高。ゴール量産で得点王と賞金を狙う。'
  },
  WG: {
    id: 'WG',
    statShare: { goal: 0.4, assist: 0.34 },
    name: 'WG（ウイング）',
    role: '切り裂くドリブラー',
    capRatio: { tec: 1.25, phy: 1.05, iq: 0.85, sht: 1.05 },
    matchWeight: { shoot: 0.48, mid: 0.37, def: 0.15 },
    desc: '技術上限が突出し、突破からの得点とアシストを両立。'
  },
  OMF: {
    id: 'OMF',
    statShare: { goal: 0.27, assist: 0.5 },
    name: 'OMF（トップ下）',
    role: '創造のファンタジスタ',
    capRatio: { tec: 1.25, phy: 0.8, iq: 1.2, sht: 0.95 },
    matchWeight: { shoot: 0.38, mid: 0.48, def: 0.14 },
    desc: '技術と戦術眼の双璧。アシスト量産でMOM獲得率が高い。'
  },
  CMF: {
    id: 'CMF',
    statShare: { goal: 0.1, assist: 0.42 },
    name: 'CMF（ボランチ）',
    role: '中盤のダイナモ',
    capRatio: { tec: 1.05, phy: 1.05, iq: 1.2, sht: 0.85 },
    matchWeight: { shoot: 0.24, mid: 0.52, def: 0.24 },
    desc: '攻守の要として試合支配率を高め、勝率を安定させる万能型。'
  },
  SB: {
    id: 'SB',
    statShare: { goal: 0.04, assist: 0.3 },
    name: 'SB（サイドバック）',
    role: '上下動する鉄人',
    capRatio: { tec: 1.0, phy: 1.2, iq: 1.05, sht: 0.85 },
    matchWeight: { shoot: 0.2, mid: 0.42, def: 0.38 },
    desc: '豊富な運動量で攻守に貢献し、守備的出場遺伝子も育つ。'
  },
  CB: {
    id: 'CB',
    statShare: { goal: 0.06, assist: 0.04 },
    name: 'CB（センターバック）',
    role: '最終ラインの要塞',
    capRatio: { tec: 0.85, phy: 1.3, iq: 1.15, sht: 0.75 },
    matchWeight: { shoot: 0.12, mid: 0.28, def: 0.6 },
    desc: '身体上限が全POS最高。失点を激減させ鉄壁の勝率を誇る。'
  },
  GK: {
    id: 'GK',
    // GKは点を取らない。宇宙規模に達したときだけ例外（simulateAutoMatch 参照）
    statShare: { goal: 0.0, assist: 0.02 },
    name: 'GK（ゴールキーパー）',
    role: '最後の守護神',
    capRatio: { tec: 0.9, phy: 1.25, iq: 1.25, sht: 0.65 },
    matchWeight: { shoot: 0.08, mid: 0.24, def: 0.68 },
    desc: '圧倒的セーブ率で格上相手にも引き分け・勝利をもぎ取る。'
  }
};

// --- 体格タイプ定義（4段階・それぞれ固有の体格ゲノム対応） ---
const BODY_TYPES = {
  agile: {
    id: 'agile',
    name: '小柄・俊敏型',
    height: 162,
    capMult: { tec: 1.14, phy: 0.88, iq: 1.06, sht: 0.96 },
    stamCostMult: 0.9,
    desc: '162cm。低重心と俊敏性で技術上限UP＆消費体力-10%。'
  },
  balanced: {
    id: 'balanced',
    name: '標準・万能型',
    height: 176,
    capMult: { tec: 1.02, phy: 1.02, iq: 1.02, sht: 1.02 },
    stamCostMult: 1.0,
    desc: '176cm。全能力がバランス良く伸びる王道アスリート体型。'
  },
  tall: {
    id: 'tall',
    name: '長身・パワー型',
    height: 190,
    capMult: { tec: 0.94, phy: 1.14, iq: 0.98, sht: 1.08 },
    stamCostMult: 1.05,
    desc: '190cm。空中戦とフィジカル・決定力上限に優れる大型体型。'
  },
  giant: {
    id: 'giant',
    name: '超大型・規格外',
    height: 202,
    capMult: { tec: 0.86, phy: 1.25, iq: 0.94, sht: 1.16 },
    stamCostMult: 1.12,
    desc: '202cm。圧倒的リーチと規格外の身体・決定力上限を誇る巨人。'
  }
};

// --- マイ戦術スタイル（4種・戦術熟練Lvが輪廻後も永続継承！） ---
const TACTICAL_STYLES = {
  balanced: {
    id: 'balanced',
    name: 'バランス・トータル',
    short: '全戦力+5% & 熟練で全成長UP',
    zoneGainMult: 1.0,
    ptGainMult: 1.0,
    shootMult: 1.05,
    midMult: 1.05,
    defMult: 1.05,
    stamCostMult: 1.0
  },
  gegenpress: {
    id: 'gegenpress',
    name: 'ゲーゲン・ハイプレス',
    short: '攻撃+18% & ZONE+40%（体力消費+12%）',
    zoneGainMult: 1.4,
    ptGainMult: 1.0,
    shootMult: 1.18,
    midMult: 1.1,
    defMult: 0.92,
    stamCostMult: 1.12
  },
  tikitaka: {
    id: 'tikitaka',
    name: 'ポゼッション支配',
    short: '中盤+22% & 戦術Pt+25%（技術戦術重視）',
    zoneGainMult: 1.1,
    ptGainMult: 1.25,
    shootMult: 1.04,
    midMult: 1.22,
    defMult: 1.02,
    stamCostMult: 0.95
  },
  catenaccio: {
    id: 'catenaccio',
    name: 'カテナチオ・堅守速攻',
    short: '守備+26% & 格上戦力+12%（体力消費-10%）',
    zoneGainMult: 0.95,
    ptGainMult: 1.1,
    shootMult: 1.08,
    midMult: 0.96,
    defMult: 1.26,
    stamCostMult: 0.9
  }
};

// --- 欧州4ヶ国リーグ＆宿敵スター選手（欧州リーグ熟練Lvが輪廻後も永続継承！） ---
const EURO_COUNTRIES = {
  england: {
    id: 'england',
    name: 'イングランド1部',
    leagueName: 'プレミア・トップリーグ',
    rivalName: 'オスカー・ブラッドリー',
    rivalRating: 1150,
    rivalQuote: '「フィジカルとゴール数で俺に勝てる奴はいない！」',
    defeatQuote: '「バケモノめ…！この俺がパワーでも決定力でも完敗するとは…！」',
    perkDesc: '賞金+12% / 身体・決定成長+6%'
  },
  spain: {
    id: 'spain',
    name: 'スペイン1部',
    leagueName: 'ラ・プリメーラ・リーグ',
    rivalName: 'ハビエル・デルソル',
    rivalRating: 1220,
    rivalQuote: '「ボールを奪えるものなら奪ってみなよ。」',
    defeatQuote: '「信じられない…！俺のドリブルと戦術眼を完全に読み切るなんて…！」',
    perkDesc: '技術・戦術成長+8% / 戦術Pt+15%'
  },
  italy: {
    id: 'italy',
    name: 'イタリア1部',
    leagueName: 'セリエ・カルチョ1部',
    rivalName: 'マッテオ・リヴァーニ',
    rivalRating: 1180,
    rivalQuote: '「勝利への執念も筋肉の仕上がりも、俺が世界一だ！」',
    defeatQuote: '「クソッ…！最後まで走り抜く執念で俺を上回るとは認めるしかないな…！」',
    perkDesc: '守備戦力+12% / 寿命・回復強化'
  },
  france: {
    id: 'france',
    name: 'フランス1部',
    leagueName: 'リーグ・アン・エリート',
    rivalName: 'リュカ・ドゥフォール',
    rivalRating: 1120,
    rivalQuote: '「俺のスピードに追いつけるDFは地球上に存在しない！」',
    defeatQuote: '「なっ…！？ 俺のトップスピードに余裕で追いついて抜き去っただと…！？」',
    perkDesc: 'ファン獲得+20% / 全試合戦力+6%'
  }
};

// --- 次世代・愛弟子候補（全4人・いつでも切替可能＆絆Lv.5コンプ図鑑！） ---
const PROTEGE_ARCHETYPES = {
  ren: {
    id: 'ren',
    name: '天宮 蓮',
    pos: 'CF',
    title: '不屈の点取り屋',
    greetQuote: '「師匠！俺、必ず師匠を超える日本一のストライカーになります！」',
    trainQuote: '「師匠のシュートフォーム、完全に体に染み込んできました！」',
    perkText: '決定戦力 +3%/絆Lv & 全上限 +1.5/絆Lv'
  },
  soma: {
    id: 'soma',
    name: '神代 蒼真',
    pos: 'OMF',
    title: '天才司令塔',
    greetQuote: '「あなたのパスコースの描き方、すべて盗ませてもらいますよ。」',
    trainQuote: '「なるほど…2手先のスペースがはっきり見えるようになりました！」',
    perkText: '戦術Pt +6%/絆Lv & 技術戦術成長 +3%/絆Lv'
  },
  raizo: {
    id: 'raizo',
    name: '黒鉄 雷蔵',
    pos: 'CB',
    title: '鋼鉄の守護壁',
    greetQuote: '「師匠の背中を追って、誰にも抜かれない最強のDFになります！」',
    trainQuote: '「1対1のデュエルなら、もう世界のFWにも負けません！」',
    perkText: '守備戦力 +4%/絆Lv & 体力上限 +6/絆Lv'
  },
  kanade: {
    id: 'kanade',
    name: '白鳥 奏',
    pos: 'WG',
    title: '音速のファンタジスタ',
    greetQuote: '「師匠と一緒に世界のピッチを駆け抜けるのが夢なんです！」',
    trainQuote: '「今の切り返し、完璧でしたよね！もっと練習しましょう！」',
    perkText: '全試合戦力 +2.5%/絆Lv & ファン獲得 +6%/絆Lv'
  }
};

// --- キャリアマルチエンディング（ED1〜ED7） ---
const ENDINGS_DEF = [
  {
    id: 'ed_hometown',
    code: 'ED1',
    name: '郷土の英雄・蒼空の魂',
    desc: '地元クラブ「蒼空FC」の仲間と絆を深め、地域愛に満ちたキャリアを築く',
    rewardText: '永続報酬：蒼空FC同僚・施設効果 ×1.25倍',
    check: (s) => (s.localClubLv || 1) >= 4 || (s.relations?.teamChem || 1) >= 8
  },
  {
    id: 'ed_j_legend',
    code: 'ED2',
    name: 'Jリーグの伝説・国民的英雄',
    desc: 'J1リーグ昇格を果たし、日本のフットボール史に名を刻む',
    rewardText: '永続報酬：全能力成長 ×1.12倍 ＆ 初期資金 +15,000円',
    check: (s) => (s.categoryId || 0) >= 11
  },
  {
    id: 'ed_euro_king',
    code: 'ED3',
    name: '欧州チャンピオンズ王者',
    desc: '欧州4大リーグ＆欧州チャンピオンカップ（CC）の舞台で頂点を極める',
    rewardText: '永続報酬：全能力上限 +14 ＆ 賞金 ×1.20倍',
    check: (s) => (s.categoryId || 0) >= 13
  },
  {
    id: 'ed_world_myth',
    code: 'ED4',
    name: '世界を制したW杯の覇者',
    desc: '日本代表としてW杯制覇カテゴリに到達し、世界の頂点に立つ',
    rewardText: '永続報酬：獲得継承結晶 ×1.25倍 ＆ ZONE溜まりやすさ +20%',
    check: (s) => (s.categoryId || 0) >= 14
  },
  {
    id: 'ed_eternal_50',
    code: 'ED5',
    name: '不老の鉄人・50歳の現役伝説',
    desc: '衰えに抗い続け、50歳以上の現役選手としてピッチに立ち続ける',
    rewardText: '永続報酬：32歳以降の衰え減衰 -30% ＆ 体力回復 +18%',
    check: (s) => (s.age || 0) >= 50
  },
  {
    id: 'ed_parent_child',
    code: 'ED6',
    name: '親子二代・世界制覇の絆',
    desc: '愛するパートナーと家庭を築き、プロデビューした愛児と共に戦う',
    rewardText: '永続報酬：全能力上限 +20 ＆ 全試合戦力 ×1.15倍',
    check: (s) => Boolean(s.life?.childActive)
  },
  {
    id: 'ed_cosmic_god',
    code: 'ED7',
    name: '宇宙評議会・銀河の最高神',
    desc: '第5段階転生を経て宇宙フットボール評議会の頂点に君臨する',
    rewardText: '永続報酬：全能力成長 ×1.40倍 ＆ 全試合戦力 ×1.30倍',
    check: (s) => (s.categoryId || 0) >= 17
  }
];

// --- 縛り輪廻チャレンジ（CH1〜CH8・意味のある制約＋達成で永続報酬＋挑戦前資産保護） ---
const CHALLENGES_DEF = [
  {
    id: 'ch_no_gear',
    code: 'CH1',
    name: 'ハングリー精神の証明',
    ruleText: '制約：道具・自己投資の購入禁止（終了後に元の資産へ完全復元）',
    goalText: '目標：J1リーグカテゴリへ到達',
    rewardText: '永続報酬：全能力成長 ×1.35倍',
    checkGoal: (s) => (s.categoryId || 0) >= 11
  },
  {
    id: 'ch_pure_body',
    code: 'CH2',
    name: '肉体純化・戦術封印の獣',
    ruleText: '制約：戦術練習＆戦術スタイル変更禁止（フィジカルと技術のみで突破）',
    goalText: '目標：欧州4大リーグ中堅クラブへ到達',
    rewardText: '永続報酬：全試合戦力 ×1.30倍 ＆ 身体・技術成長+20%',
    checkGoal: (s) => (s.categoryId || 0) >= 12
  },
  {
    id: 'ch_lone_wolf',
    code: 'CH3',
    name: '孤高のフットボール求道者',
    ruleText: '制約：恋愛デート・同僚飯会・趣味強化禁止',
    goalText: '目標：W杯日本代表・世界頂点へ到達',
    rewardText: '永続報酬：獲得継承結晶 ×1.40倍',
    checkGoal: (s) => (s.categoryId || 0) >= 14
  },
  {
    id: 'ch_half_cap',
    code: 'CH4',
    name: '凡人の限界突破',
    ruleText: '制約：全能力の上限値が半分（50%）に制限',
    goalText: '目標：欧州4大リーグ中堅クラブへ到達',
    rewardText: '永続報酬：全能力上限 +40 ＆ 限界後成長効率2.5倍',
    checkGoal: (s) => (s.categoryId || 0) >= 12
  },
  {
    id: 'ch_twilight_32',
    code: 'CH5',
    name: '黄昏のラストダンス',
    ruleText: '制約：32歳・衰え期からキャリアをスタート',
    goalText: '目標：現役引退までにJ1リーグへ昇格',
    rewardText: '永続報酬：32歳以降の衰え減衰 -45% ＆ 寿命+3歳',
    checkGoal: (s) => (s.categoryId || 0) >= 11
  },
  {
    id: 'ch_solo_carry',
    code: 'CH6',
    name: '孤高のワンマンチーム',
    ruleText: '制約：蒼空FC同僚・施設援護ボーナス無効',
    goalText: '目標：欧州4大リーグ中堅クラブへ到達',
    rewardText: '永続報酬：蒼空FC同僚・施設効果 ×1.65倍',
    checkGoal: (s) => (s.categoryId || 0) >= 12
  },
  {
    id: 'ch_no_memory',
    code: 'CH7',
    name: '記憶封印の純粋挑戦',
    ruleText: '制約：習慣熟練引き継ぎ＆全ブレイクスルー無効（終了後復元）',
    goalText: '目標：W杯日本代表・世界頂点へ到達',
    rewardText: '永続報酬：全習慣熟練効率 ×1.60倍 ＆ 初期能力+25',
    checkGoal: (s) => (s.categoryId || 0) >= 14
  },
  {
    id: 'ch_ascetic_god',
    code: 'CH8',
    name: '無一文の求道神',
    ruleText: '制約：道具・ブレイクスルー・蒼空FC・交流すべて禁止（終了後復元）',
    goalText: '目標：J1リーグカテゴリへ到達',
    rewardText: '永続報酬：全能力上限 +120 ＆ 全試合戦力 ×1.50倍 ＆ 結晶×1.3倍',
    checkGoal: (s) => (s.categoryId || 0) >= 11
  }
];

// --- 所属カテゴリ（全19段階：100周目神域バランス・円単位報酬） ---
const CATEGORIES = [
  { id: 0, name: 'キッズサッカースクール', clubDefault: '蒼空キッズSC', reqRating: 0, oppPower: 4.5, baseReward: 800, fanGain: 1 },
  { id: 1, name: '地域ジュニア少年団', clubDefault: '蒼空FCジュニア', reqRating: 6.5, oppPower: 7.5, baseReward: 1500, fanGain: 2 },
  { id: 2, name: '地元中学校サッカー部', clubDefault: '蒼空市立第一中学', reqRating: 13, oppPower: 14.5, baseReward: 2600, fanGain: 4 },
  { id: 3, name: 'Jクラブ下部ジュニアユース', clubDefault: '蒼空FC JY', reqRating: 21, oppPower: 23, baseReward: 4200, fanGain: 9 },
  { id: 4, name: '地元県立高校サッカー部', clubDefault: '県立蒼空高校', reqRating: 31, oppPower: 34, baseReward: 6500, fanGain: 18 },
  { id: 5, name: '名門Jユース・全国強豪校', clubDefault: '蒼空FCユース', reqRating: 45, oppPower: 49, baseReward: 10000, fanGain: 38 },
  { id: 6, name: '大学サッカー部', clubDefault: '東都体育大学蹴球部', reqRating: 58, oppPower: 64, baseReward: 14500, fanGain: 65 },
  { id: 7, name: '都道府県社会人リーグ', clubDefault: '蒼空FC社会人', reqRating: 82, oppPower: 90, baseReward: 24000, fanGain: 130 },
  { id: 8, name: 'JFL（日本フットボールL）', clubDefault: '蒼空FC（JFL）', reqRating: 125, oppPower: 138, baseReward: 42000, fanGain: 300 },
  { id: 9, name: 'J3リーグ（プロ契約）', clubDefault: '蒼空FC（J3トップ）', reqRating: 195, oppPower: 215, baseReward: 85000, fanGain: 800 },
  { id: 10, name: 'J2リーグ', clubDefault: '蒼空FC（J2トップ）', reqRating: 310, oppPower: 340, baseReward: 170000, fanGain: 2200 },
  { id: 11, name: 'J1リーグ', clubDefault: '蒼空FC（J1トップ）', reqRating: 500, oppPower: 550, baseReward: 360000, fanGain: 6500 },
  { id: 12, name: '欧州4大リーグ中堅クラブ', clubDefault: '欧州1部クラブ', reqRating: 850, oppPower: 930, baseReward: 820000, fanGain: 20000 },
  { id: 13, name: '欧州チャンピオンカップ強豪', clubDefault: '欧州CC常連メガクラブ', reqRating: 1500, oppPower: 1650, baseReward: 1900000, fanGain: 65000 },
  { id: 14, name: 'W杯日本代表・世界頂点', clubDefault: '日本代表・世界選抜', reqRating: 2800, oppPower: 3100, baseReward: 4800000, fanGain: 220000 },
  { id: 15, name: '銀河系ドリームイレブン', clubDefault: 'ギャラクシーXI', reqRating: 6500, oppPower: 7200, baseReward: 14000000, fanGain: 750000 },
  { id: 16, name: 'フットボールの創世神', clubDefault: 'ジェネシス・パンテオン', reqRating: 18000, oppPower: 20000, baseReward: 45000000, fanGain: 2800000 },
  { id: 17, name: '銀河評議会代表イレブン', clubDefault: 'アストラル評議会代表', reqRating: 55000, oppPower: 61000, baseReward: 160000000, fanGain: 12000000 },
  { id: 18, name: '宇宙フットボール評議会・最高神', clubDefault: 'コスモ・スープリームFC', reqRating: 180000, oppPower: 200000, baseReward: 650000000, fanGain: 55000000 }
];

// --- 俺TUEEEE無双ランク（1周目は「無名の補欠候補」からスタート） ---
const getUnrivaledRank = (age, rating, totalGenerations = 1) => {
  const expectedByAge = age <= 11 ? 8 : age <= 14 ? 20 : age <= 17 ? 42 : age <= 21 ? 85 : 160;
  const ratio = rating / expectedByAge;

  if (ratio >= 30 || rating >= 6500) {
    return {
      lv: 5,
      title: '次元超越のフットボール神',
      badge: 'bg-rose-950 border-rose-400 text-rose-200',
      fanMult: 1.4,
      zoneMult: 1.2,
      flavor:
        '「もはや同じ人間とは思えない…！」世界中の名将が戦術を放棄して頭を抱える、サッカー史の常識を塗り替えた神域の存在！'
    };
  }
  if (ratio >= 11.0 || rating >= 1500) {
    return {
      lv: 4,
      title: '生ける伝説・世界の王',
      badge: 'bg-amber-950 border-amber-400 text-amber-200',
      fanMult: 1.28,
      zoneMult: 1.15,
      flavor:
        '「信じられん、一人で試合の空気を支配しているぞ！」相手のダブルチームもトリプルチームも赤子のように翻弄する絶対的支配者！'
    };
  }
  if (ratio >= 4.2 || rating >= 380) {
    return {
      lv: 3,
      title: '世代最強の怪物',
      badge: 'bg-purple-950 border-purple-400 text-purple-200',
      fanMult: 1.18,
      zoneMult: 1.1,
      flavor:
        '「なんだあのバケモノは…！プロスカウトがネット裏で腰を抜かしているぞ！」格上相手を次々と薙ぎ倒す異次元の天才！'
    };
  }
  if (ratio >= 1.8 || (totalGenerations >= 2 && rating >= 14)) {
    return {
      lv: 2,
      title: '規格外の神童',
      badge: 'bg-sky-950 border-sky-400 text-sky-200',
      fanMult: 1.08,
      zoneMult: 1.05,
      flavor:
        '「おい見たか今のトラップ！？ 同年代のレベルじゃねえぞ…！」前世の経験と記憶が身体に馴染み、周囲の視線が驚きに変わっていく！'
    };
  }
  return {
    lv: 1,
    title: '無名の補欠候補',
    badge: 'bg-slate-900 border-slate-700 text-slate-400',
    fanMult: 1.0,
    zoneMult: 1.0,
    flavor:
      '「足も遅いしトラップも下手だな…」まだ誰にも期待されていない弱小チームの補欠候補。今はただ泥臭く基礎を積み上げるしかない。'
  };
};

// --- ファン熱狂ランク計算 ---
const getFanRankInfo = (fans = 0) => {
  if (fans >= 5000000) {
    return { lv: 6, title: '世界熱狂神話', powerMult: 1.28, crystalMult: 1.22, zoneMult: 1.18, nextReq: null };
  }
  if (fans >= 500000) {
    return { lv: 5, title: '国民的メガスター', powerMult: 1.2, crystalMult: 1.16, zoneMult: 1.14, nextReq: 5000000 };
  }
  if (fans >= 50000) {
    return { lv: 4, title: '全国区カリスマ', powerMult: 1.14, crystalMult: 1.1, zoneMult: 1.1, nextReq: 500000 };
  }
  if (fans >= 5000) {
    return { lv: 3, title: '満員サポーター', powerMult: 1.09, crystalMult: 1.06, zoneMult: 1.06, nextReq: 50000 };
  }
  if (fans >= 400) {
    return { lv: 2, title: '地元の人気者', powerMult: 1.04, crystalMult: 1.03, zoneMult: 1.03, nextReq: 5000 };
  }
  return { lv: 1, title: '無名の新星', powerMult: 1.0, crystalMult: 1.0, zoneMult: 1.0, nextReq: 400 };
};

// --- 4段階ティア制ライバル定義 ---
const RIVAL_TIERS = [
  {
    tier: 0,
    minCat: 0,
    name: '皇 怜央',
    alias: 'ユース年代の天才司令塔',
    baseRating: 18,
    quote: '「お前の泥臭いサッカーじゃ、俺のパスワークには一生追いつけない。」',
    coopQuote: '「お前と組めば日本のパスサッカーは完成する！共に世界へ行こう！」',
    perkId: 'rival_perk_0',
    perkLabel: '怜央の戦術眼継承（戦術上限+4 / 戦術Pt+10%）'
  },
  {
    tier: 1,
    minCat: 8,
    name: '氷室 凱',
    alias: '鋼鉄フィジカルの怪物FW',
    baseRating: 180,
    quote: '「フィジカルが全てだ。当たりの強さで俺に勝てる日本人はいない。」',
    coopQuote: '「俺のフィジカルとお前の技術が噛み合えば、どのDFも止められん！」',
    perkId: 'rival_perk_1',
    perkLabel: '氷室の鋼鉄肉体秘伝（身体上限+7 / 決定戦力+6%）'
  },
  {
    tier: 2,
    minCat: 12,
    name: 'マルコ・ロッシ',
    alias: '欧州CCの戦術鬼才',
    baseRating: 1100,
    quote: '「欧州のインテンシティは別次元だ。極東の選手に何ができる？」',
    coopQuote: '「認めるよ…君こそが欧州最高峰のフットボーラーだ！」',
    perkId: 'rival_perk_2',
    perkLabel: 'ロッシの欧州王座秘伝（全上限+10 / 全試合戦力+7%）'
  },
  {
    tier: 3,
    minCat: 14,
    name: 'レオナルド・神崎',
    alias: 'バロンドール3連覇王者',
    baseRating: 3600,
    quote: '「世界の頂点は孤独だ。俺の領域まで上がってこられるか？」',
    coopQuote: '「ついに俺と肩を並べる男が現れたか…最高のライバルだ！」',
    perkId: 'rival_perk_3',
    perkLabel: '王者の究極神髄（全上限+18 / 全能力成長+10%）'
  }
];

// --- 恋愛パートナー候補（4タイプ・自分の属性/実績で解放・結婚後は恋愛欄非表示！） ---
const PARTNER_TYPES = {
  childhood: {
    id: 'childhood',
    name: '幼馴染のマネージャー',
    reqText: '15歳以上（条件なし）',
    checkUnlock: (s) => s.age >= 15,
    perk: '全能力成長 +5% / 自然回復 +8%'
  },
  athlete: {
    id: 'athlete',
    name: '陸上部のアスリート恋人',
    reqText: '16歳以上 & 総合力25以上',
    checkUnlock: (s, r) => s.age >= 16 && r >= 25,
    perk: '試合全戦力 +7% / 身体成長 +7%'
  },
  announcer: {
    id: 'announcer',
    name: 'スポーツアナウンサー',
    reqText: '18歳以上 & J3プロ以上 & ファン1,000人',
    checkUnlock: (s) => s.age >= 18 && (s.categoryId || 0) >= 9 && (s.fans || 0) >= 1000,
    perk: '試合賞金 +15% / ファン +20%'
  },
  actress: {
    id: 'actress',
    name: '国民的トップ女優',
    reqText: '20歳以上 & J1/欧州以上 & ファン30,000人',
    checkUnlock: (s) => s.age >= 20 && (s.categoryId || 0) >= 11 && (s.fans || 0) >= 30000,
    perk: '全能力上限 +25 / 試合賞金 +22%'
  }
};

// --- 趣味定義（4種・頭の中の知識・技能なのでタイムリープ後も永続保持！・円単位コスト） ---
const HOBBIES_DEF = [
  {
    id: 'chess',
    name: 'チェス（盤面俯瞰力）',
    minAge: 10,
    baseG: 14000,
    basePt: 90,
    growth: 2.0,
    maxLv: 5,
    short: '戦術成長+5% & 戦術Pt+7%/Lv（記憶永続）'
  },
  {
    id: 'cooking',
    name: '栄養料理（セルフケア）',
    minAge: 12,
    baseG: 12000,
    basePt: 55,
    growth: 1.95,
    maxLv: 5,
    short: '最大体力+8 & 自然回復+7%/Lv（記憶永続）'
  },
  {
    id: 'golf',
    name: 'ゴルフ（集中＆メンタル）',
    minAge: 15,
    baseG: 18000,
    basePt: 75,
    growth: 2.0,
    maxLv: 5,
    short: '最大精神+6 & 決定戦力+4%/Lv（記憶永続）'
  },
  {
    id: 'supercar',
    name: '名車コレクション知識',
    minAge: 18,
    baseG: 50000,
    basePt: 150,
    growth: 2.2,
    maxLv: 5,
    short: '試合賞金+8% & ファン+12%/Lv（記憶永続）'
  }
];

// --- 絆のお守り（全6種） ---
const CHARMS_DEF = [
  {
    id: 'charm_rival',
    name: '宿敵の交換ユニフォーム',
    source: '宿敵ライバルに5勝',
    effect: '格上・宿敵戦力 +12% / 全成長 +6%'
  },
  {
    id: 'charm_lover',
    name: '手編みの絆ミサンガ',
    source: '恋愛親密度20到達',
    effect: '体力・精神自然回復 +22% / 練習消費 -8%'
  },
  {
    id: 'charm_coach',
    name: '恩師の戦術手帳',
    source: 'コーチ指導信頼Lv.4到達',
    effect: '戦術Pt獲得 +28% / 戦術成長 +10%'
  },
  {
    id: 'charm_cup',
    name: '黄金キャプテンマーク',
    source: 'カップ戦通算3勝',
    effect: '全試合戦力 +10% / 試合賞金 +18%'
  },
  {
    id: 'charm_club',
    name: '蒼空FC名誉エンブレム',
    source: '地元クラブ育成Lv.4到達',
    effect: 'チーム援護戦力 +18% / 毎月資金 +2,500円'
  },
  {
    id: 'charm_champion',
    name: '世界制覇の記念メダル',
    source: '欧州CC強豪以上到達',
    effect: '獲得継承結晶 +15% / 全能力成長 +10%'
  }
];

// --- ハイブリッド特性定義（全7種：各POS 50試合で永久習得し、他POSでも自由に装備可能！） ---
const POSITION_TRAITS_DEF = [
  {
    id: 'trait_cf',
    pos: 'CF',
    name: '【CF特性】ボックス内の嗅覚',
    reqMatches: 50,
    effect: '決定戦力 +14% / ゴール期待値大幅UP'
  },
  {
    id: 'trait_wg',
    pos: 'WG',
    name: '【WG特性】サイドの稲妻突破',
    reqMatches: 50,
    effect: '攻撃・中盤戦力 +9% / 技術成長 +10%'
  },
  {
    id: 'trait_omf',
    pos: 'OMF',
    name: '【OMF特性】キラーパス供給',
    reqMatches: 50,
    effect: '中盤戦力 +14% / 戦術Pt獲得 +18%'
  },
  {
    id: 'trait_cmf',
    pos: 'CMF',
    name: '【CMF特性】無尽蔵の心臓',
    reqMatches: 50,
    effect: '全試合戦力 +8% / 消費体力 -10%'
  },
  {
    id: 'trait_sb',
    pos: 'SB',
    name: '【SB特性】オーバーラップ援護',
    reqMatches: 50,
    effect: '中盤・守備戦力 +10% / 自然回復 +12%'
  },
  {
    id: 'trait_cb',
    pos: 'CB',
    name: '【CB特性】空中戦の絶対王者',
    reqMatches: 50,
    effect: '守備戦力 +16% / 格上戦力 +8%'
  },
  {
    id: 'trait_gk',
    pos: 'GK',
    name: '【GK特性】神懸かりの守護壁',
    reqMatches: 50,
    effect: '守備戦力 +18% / 失点期待値大幅軽減'
  }
];

// --- ポジション別固有マイルストーンイベント（全7POS × 3段階 = 21イベント） ---
const POS_MILESTONE_EVENTS = [
  { id: 'CF_15', pos: 'CF', req: 15, title: '【CF物語1】裏抜けの極意', rewardText: '決定上限 +2', capKey: 'sht', capAdd: 2 },
  { id: 'CF_45', pos: 'CF', req: 45, title: '【CF物語2】エリア内の絶対捕食者', rewardText: '決定上限 +4', capKey: 'sht', capAdd: 4 },
  { id: 'CF_90', pos: 'CF', req: 90, title: '【CF物語3】伝説の9番継承', rewardText: '決定上限 +8', capKey: 'sht', capAdd: 8 },
  { id: 'WG_15', pos: 'WG', req: 15, title: '【WG物語1】縦突破の緩急', rewardText: '技術上限 +2', capKey: 'tec', capAdd: 2 },
  { id: 'WG_45', pos: 'WG', req: 45, title: '【WG物語2】カットインの芸術', rewardText: '技術上限 +4', capKey: 'tec', capAdd: 4 },
  { id: 'WG_90', pos: 'WG', req: 90, title: '【WG物語3】サイドを支配する稲妻', rewardText: '技術上限 +8', capKey: 'tec', capAdd: 8 },
  { id: 'OMF_15', pos: 'OMF', req: 15, title: '【OMF物語1】背後のスペース認知', rewardText: '戦術上限 +2', capKey: 'iq', capAdd: 2 },
  { id: 'OMF_45', pos: 'OMF', req: 45, title: '【OMF物語2】針の穴を通すスルーパス', rewardText: '技術上限 +4', capKey: 'tec', capAdd: 4 },
  { id: 'OMF_90', pos: 'OMF', req: 90, title: '【OMF物語3】黄金の10番の系譜', rewardText: '戦術上限 +8', capKey: 'iq', capAdd: 8 },
  { id: 'CMF_15', pos: 'CMF', req: 15, title: '【CMF物語1】360度の首振り習慣', rewardText: '戦術上限 +2', capKey: 'iq', capAdd: 2 },
  { id: 'CMF_45', pos: 'CMF', req: 45, title: '【CMF物語2】90分落ちない心臓', rewardText: '身体上限 +4', capKey: 'phy', capAdd: 4 },
  { id: 'CMF_90', pos: 'CMF', req: 90, title: '【CMF物語3】ピッチ上の指揮官', rewardText: '戦術上限 +8', capKey: 'iq', capAdd: 8 },
  { id: 'SB_15', pos: 'SB', req: 15, title: '【SB物語1】タイミング抜群のオーバーラップ', rewardText: '身体上限 +2', capKey: 'phy', capAdd: 2 },
  { id: 'SB_45', pos: 'SB', req: 45, title: '【SB物語2】ピンポイント高速クロス', rewardText: '技術上限 +4', capKey: 'tec', capAdd: 4 },
  { id: 'SB_90', pos: 'SB', req: 90, title: '【SB物語3】サイドを制圧する鉄人', rewardText: '身体上限 +8', capKey: 'phy', capAdd: 8 },
  { id: 'CB_15', pos: 'CB', req: 15, title: '【CB物語1】1対1の予測と間合い', rewardText: '身体上限 +2', capKey: 'phy', capAdd: 2 },
  { id: 'CB_45', pos: 'CB', req: 45, title: '【CB物語2】空中戦の絶対的支配', rewardText: '身体上限 +4', capKey: 'phy', capAdd: 4 },
  { id: 'CB_90', pos: 'CB', req: 90, title: '【CB物語3】難攻不落のディフェンスリーダー', rewardText: '身体上限 +8', capKey: 'phy', capAdd: 8 },
  { id: 'GK_15', pos: 'GK', req: 15, title: '【GK物語1】至近距離の反射セーブ', rewardText: '戦術上限 +2', capKey: 'iq', capAdd: 2 },
  { id: 'GK_45', pos: 'GK', req: 45, title: '【GK物語2】DFライン統率のコーチング', rewardText: '身体上限 +4', capKey: 'phy', capAdd: 4 },
  { id: 'GK_90', pos: 'GK', req: 90, title: '【GK物語3】絶望を与える神の守護壁', rewardText: '戦術上限 +8', capKey: 'iq', capAdd: 8 }
];

// --- 蒼空FC・5人の同僚選手育成定義（円単位コスト） ---
// 地元クラブを昇格させるのに必要な、自分の到達カテゴリ。
//
// 本人指摘（2026-11-23）:
//   「地元クラブがいとも簡単に世界的クラブになってしまうのも違和感」
//
// 金と戦術Ptだけで Lv7（世界王者クラブ）まで買えてしまうのがおかしい。
// 地元のクラブが世界に出ていくには、連れていく選手が世界に居る必要がある。
const LOCAL_CLUB_REQ_CAT = { 2: 12, 3: 13, 4: 13, 5: 14, 6: 15, 7: 16 };

const LOCAL_CLUB_MATES = [
  {
    id: 'mate_gk',
    name: '日向 健太',
    pos: 'GK',
    baseG: 6500,
    basePt: 25,
    growth: 1.72,
    maxLv: 20,
    short: '守備戦力 +3%/Lv（Lv3で鉄壁守護連携）'
  },
  {
    id: 'mate_cb',
    name: '鉄壁 剛',
    pos: 'CB',
    baseG: 7000,
    basePt: 28,
    growth: 1.72,
    maxLv: 20,
    short: '守備・中盤 +2.5%/Lv（Lv3で最終ライン統率）'
  },
  {
    id: 'mate_cmf',
    name: '水瀬 遥',
    pos: 'CMF',
    baseG: 7500,
    basePt: 32,
    growth: 1.74,
    maxLv: 20,
    short: '中盤戦力 +3%/Lv & 戦術Pt +3%/Lv'
  },
  {
    id: 'mate_wg',
    name: '風間 疾風',
    pos: 'WG',
    baseG: 8000,
    basePt: 35,
    growth: 1.74,
    maxLv: 20,
    short: '攻撃・中盤 +2.5%/Lv & アシスト率UP'
  },
  {
    id: 'mate_fw',
    name: '神谷 蓮',
    pos: 'CF',
    baseG: 8500,
    basePt: 38,
    growth: 1.76,
    maxLv: 20,
    short: '決定戦力 +3%/Lv（Lv3でツートップ共鳴）'
  }
];

// --- 蒼空FC・4つのクラブ施設運営定義（円単位コスト） ---
const LOCAL_CLUB_FACILITIES = [
  {
    id: 'fac_turf',
    name: 'ハイブリッド天然芝ピッチ',
    baseG: 14000,
    basePt: 50,
    growth: 1.85,
    maxLv: 15,
    short: '全練習成長 +3.5%/Lv & 蒼空FC強化'
  },
  {
    id: 'fac_cafeteria',
    name: '専用栄養食堂＆リカバリー棟',
    baseG: 15000,
    basePt: 55,
    growth: 1.85,
    maxLv: 15,
    short: '体力・精神自然回復 +6%/Lv'
  },
  {
    id: 'fac_scout',
    name: '全国スカウト網＆ユース寮',
    baseG: 18000,
    basePt: 70,
    growth: 1.9,
    maxLv: 15,
    short: 'ファン獲得 +8%/Lv & 試合賞金 +5%/Lv'
  },
  {
    id: 'fac_stadium',
    name: '蒼空専用スタジアム拡張',
    baseG: 26000,
    basePt: 100,
    growth: 1.95,
    maxLv: 15,
    short: '毎月クラブ収益 +4,500円/Lv & ファン増加'
  }
];

// --- ベースゲノム定義（100周目バランスへ倍率調整＆7歳ジュニア進路3種＋子ども才能別ゲノム追加） ---
const BASE_GENOME_DEF = [
  {
    id: 'striker_dna',
    name: '点取り屋の遺伝子',
    maxLv: 5,
    condition: '公式戦通算ゴール数',
    effectDesc: (lv) => `決定戦力 +${lv * 2.5}% / 決定成長 +${lv * 2.5}%`,
    getStatVal: (s) => s.totalCareerGoals || 0,
    step: 45
  },
  {
    id: 'dribbler_dna',
    name: '閃光ドリブル遺伝子',
    maxLv: 5,
    condition: '技術練習の累計回数',
    effectDesc: (lv) => `技術成長 +${lv * 2.5}% / 練習閃き率 +${(lv * 0.6).toFixed(1)}%`,
    getStatVal: (s) => s.careerDrillCounts?.tech_drill || 0,
    step: 220
  },
  {
    id: 'engine_dna',
    name: '無尽蔵の肺遺伝子',
    maxLv: 5,
    condition: '身体練習の累計回数',
    effectDesc: (lv) => `体力自然回復 +${lv * 4}%`,
    getStatVal: (s) => s.careerDrillCounts?.phy_drill || 0,
    step: 220
  },
  {
    id: 'maestro_dna',
    name: '司令塔の遺伝子',
    maxLv: 5,
    condition: '公式戦通算アシスト数',
    effectDesc: (lv) => `技術・戦術成長 +${lv * 2.5}%`,
    getStatVal: (s) => s.totalCareerAssists || 0,
    step: 35
  },
  {
    id: 'guardian_dna',
    name: '守護神の遺伝子',
    maxLv: 5,
    condition: '精神練習の累計回数',
    effectDesc: (lv) => `精神自然回復 +${lv * 4}%`,
    getStatVal: (s) => s.careerDrillCounts?.mental_image || 0,
    step: 200
  },
  {
    id: 'fortress_dna',
    name: '鉄壁DFの遺伝子',
    maxLv: 5,
    condition: '守備的POS(CB/GK/SB)出場',
    effectDesc: (lv) => `守備走力 +${lv * 3}%`,
    getStatVal: (s) => s.careerDefMatches || 0,
    step: 60
  },
  {
    id: 'protege_bond_dna',
    name: '【師弟】未来へ繋ぐ絆遺伝子',
    maxLv: 10,
    condition: '愛弟子との累計絆・特訓実績',
    effectDesc: (lv) => `全上限 +${(lv * 1.5).toFixed(1)} / 師弟連携効果 +${lv * 5}%`,
    getStatVal: (s) => s.careerProtegeExp || 0,
    step: 16
  },
  {
    id: 'child_son_prodigy_dna',
    name: '【親子鷹・息子】剛腕ストライカー二世遺伝子',
    maxLv: 8,
    condition: '息子サッカー選手との累計勝利',
    effectDesc: (lv) => `決定・身体上限 +${(lv * 2.5).toFixed(1)} / 攻撃戦力 +${lv * 4}%`,
    getStatVal: (s) => s.careerSonWins || 0,
    step: 10
  },
  {
    id: 'child_daughter_genius_dna',
    name: '【親子鷹・娘】天賦のファンタジスタ二世遺伝子',
    maxLv: 8,
    condition: '娘サッカー選手との累計勝利',
    effectDesc: (lv) => `技術・戦術上限 +${(lv * 2.5).toFixed(1)} / 全成長 +${lv * 3}%`,
    getStatVal: (s) => s.careerDaughterWins || 0,
    step: 10
  },
  {
    id: 'king_eternal_dna',
    name: '【現役魂】キング・レジェンド遺伝子',
    maxLv: 5,
    condition: '35歳以上の衰え期での現役月数',
    effectDesc: (lv) => `衰え減衰 -${lv * 10}% / 引退寿命 +${(lv * 0.6).toFixed(1)}歳`,
    getStatVal: (s) => s.careerVeteranMonths || 0,
    step: 72
  },
  {
    id: 'iron_will_dna',
    name: '不屈の勝者遺伝子',
    maxLv: 5,
    condition: '公式戦通算勝利数',
    effectDesc: (lv) => `全試合戦力 +${lv * 2}%`,
    getStatVal: (s) => s.careerWins || 0,
    step: 90
  },
  {
    id: 'allrounder_dna',
    name: '万能戦士の遺伝子',
    maxLv: 5,
    condition: '公式戦通算出場試合数',
    effectDesc: (lv) => `全試合戦力 +${lv * 2}% / 全成長 +${(lv * 1.5).toFixed(1)}%`,
    getStatVal: (s) => s.careerTotalMatches || 0,
    step: 150
  },
  {
    id: 'total_player_dna',
    name: '【全POS制覇】トータルプレイヤー遺伝子',
    maxLv: 14,
    condition: '全7ポジション各100試合熟練進捗',
    effectDesc: (lv) => `全上限 +${(lv * 1.2).toFixed(1)} / 全戦力 +${(lv * 1.5).toFixed(1)}%`,
    getStatVal: (s) => {
      const pm = s.careerPosMatches || {};
      return Object.keys(POSITIONS).reduce((acc, p) => acc + Math.min(100, pm[p] || 0), 0);
    },
    step: 50
  },
  {
    id: 'agile_body_dna',
    name: '【体格】小柄・敏捷遺伝子',
    maxLv: 5,
    isBodyGenome: true,
    condition: '小柄・俊敏型(162cm)での勝利数',
    effectDesc: (lv) => `技術成長 +${lv * 3}% / 消費体力 -${lv * 1.5}%`,
    getStatVal: (s) => s.careerBodyWins?.agile || 0,
    step: 55
  },
  {
    id: 'balanced_body_dna',
    name: '【体格】標準・万能遺伝子',
    maxLv: 5,
    isBodyGenome: true,
    condition: '標準・万能型(176cm)での勝利数',
    effectDesc: (lv) => `全能力成長 +${lv * 2}%`,
    getStatVal: (s) => s.careerBodyWins?.balanced || 0,
    step: 55
  },
  {
    id: 'tall_body_dna',
    name: '【体格】長身・パワー遺伝子',
    maxLv: 5,
    isBodyGenome: true,
    condition: '長身・パワー型(190cm)での勝利数',
    effectDesc: (lv) => `身体・決定成長 +${lv * 3}%`,
    getStatVal: (s) => s.careerBodyWins?.tall || 0,
    step: 55
  },
  {
    id: 'giant_body_dna',
    name: '【体格】超大型・規格外遺伝子',
    maxLv: 5,
    isBodyGenome: true,
    condition: '超大型・規格外(202cm)での勝利数',
    effectDesc: (lv) => `身体上限 +${lv * 1.5} / 決定戦力 +${lv * 3}%`,
    getStatVal: (s) => s.careerBodyWins?.giant || 0,
    step: 55
  },
  {
    id: 'romance_bond_dna',
    name: '【恋愛】真実の愛の遺伝子',
    maxLv: 5,
    condition: '恋愛親密度の累計値',
    effectDesc: (lv) => `全能力成長 +${lv * 2}% / 精神回復 +${lv * 4}%`,
    getStatVal: (s) => s.careerTotalAffection || 0,
    step: 35
  },
  {
    id: 'family_guardian_dna',
    name: '【家族】守護すべき家庭の遺伝子',
    maxLv: 5,
    condition: '結婚・第一子誕生イベント達成数',
    effectDesc: (lv) => `全上限 +${(lv * 1.6).toFixed(1)} / 全戦力 +${lv * 2.5}%`,
    getStatVal: (s) => s.careerFamilyEvents || 0,
    step: 1
  },
  {
    id: 'hobby_master_dna',
    name: '【趣味】多才なる求道者遺伝子',
    maxLv: 5,
    condition: '趣味レベルの累計達成数',
    effectDesc: (lv) => `試合賞金 +${lv * 4}% / 全成長 +${(lv * 1.5).toFixed(1)}%`,
    getStatVal: (s) => s.careerHobbyTotalLv || 0,
    step: 4
  },
  {
    id: 'coach_mentor_dna',
    name: '【人間関係】名将の教え遺伝子',
    maxLv: 5,
    condition: '恩師コーチの特別指導回数',
    effectDesc: (lv) => `練習熟練度増加 +1 / 戦術成長 +${lv * 3}%`,
    getStatVal: (s) => s.careerCoachLessons || 0,
    step: 5
  },
  {
    id: 'team_synergy_dna',
    name: '【人間関係】阿吽の呼吸遺伝子',
    maxLv: 5,
    condition: '同僚飯会＆連携イベント回数',
    effectDesc: (lv) => `中盤・守備戦力 +${lv * 3}%`,
    getStatVal: (s) => s.careerTeamDinners || 0,
    step: 5
  },
  {
    id: 'rival_crusher_dna',
    name: '【宿敵】好敵手凌駕の遺伝子',
    maxLv: 5,
    condition: '宿敵ライバル通算撃破数',
    effectDesc: (lv) => `格上・宿敵戦力 +${lv * 3.5}%`,
    getStatVal: (s) => s.careerRivalWins || 0,
    step: 8
  },
  {
    id: 'media_star_dna',
    name: '【注目】国民的スーパースター遺伝子',
    maxLv: 5,
    condition: 'メディア代表アピール通算回数',
    effectDesc: (lv) => `全上限 +${(lv * 1.2).toFixed(1)} / ファン獲得 +${lv * 8}%`,
    getStatVal: (s) => s.careerMediaCount || 0,
    step: 6
  },
  {
    id: 'local_club_dna',
    name: '【地元愛】蒼空FC育成の遺伝子',
    maxLv: 5,
    condition: '蒼空FCの同僚＆施設合計Lv',
    effectDesc: (lv) => `蒼空FC戦力支援 +${lv * 4}% / 賞金 +${lv * 5}%`,
    getStatVal: (s) => {
      const mSum = Object.values(s.clubMates || {}).reduce((a, b) => a + b, 0);
      const fSum = Object.values(s.clubFacilities || {}).reduce((a, b) => a + b, 0);
      return mSum + fSum;
    },
    step: 8
  },
  {
    id: 'euro_cc_dna',
    name: '【欧州CC】チャンピオンの遺伝子',
    maxLv: 5,
    condition: '欧州CC強豪以上での勝利数',
    effectDesc: (lv) => `全上限 +${(lv * 2.5).toFixed(1)} / 全戦力 +${lv * 3}%`,
    getStatVal: (s) => s.careerEuroCcWins || 0,
    step: 20
  },
  {
    id: 'world_champ_dna',
    name: '【世界制覇】ワールドチャンピオン遺伝子',
    maxLv: 5,
    condition: 'W杯・世界頂点以上での勝利数',
    effectDesc: (lv) => `獲得継承結晶 +${lv * 5}% / 全成長 +${lv * 3}%`,
    getStatVal: (s) => s.careerWorldWins || 0,
    step: 15
  },
  // --- 7歳ジュニア期進路ゲノム（3種） ---
  {
    id: 'jr_local_dna',
    name: '【7歳進路】街のサッカー小僧遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '地元ジュニア少年団ルートでの勝利',
    effectDesc: (lv) => `体力回復 +${Math.min(5, lv) * 4}% / 全上限 +${(Math.max(0, lv - 5) * 0.25).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.jr_local || 0,
    step: 6
  },
  {
    id: 'jr_elite_dna',
    name: '【7歳進路】早期英才教育遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: 'エリートジュニアコースルートでの勝利',
    effectDesc: (lv) => `技術成長 +${Math.min(5, lv) * 4}% / 全上限 +${(Math.max(0, lv - 5) * 0.3).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.jr_elite || 0,
    step: 6
  },
  {
    id: 'jr_abroad_dna',
    name: '【7歳留学】幼少期海外カンテラ遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '幼少期海外留学（イベリア/南米）ルートでの勝利',
    effectDesc: (lv) => `全成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.jr_abroad || 0,
    step: 6
  },
  // --- 12歳中学期進路ゲノム（4種） ---
  {
    id: 'grassroots_dna',
    name: '【12歳進路】雑草魂の遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '地元弱小中学部ルートでの勝利',
    effectDesc: (lv) => `格上戦力 +${Math.min(5, lv) * 4}% / 全上限 +${(Math.max(0, lv - 5) * 0.3).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.local_jhs || 0,
    step: 4
  },
  {
    id: 'regional_jhs_dna',
    name: '【12歳進路】地域強豪クラブ遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '地域強豪クラブユースルートでの勝利',
    effectDesc: (lv) => `身体・決定成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.3).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.regional_jhs || 0,
    step: 4
  },
  {
    id: 'j_elite_dna',
    name: '【12歳進路】J下部JYエリート遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: 'J下部JYルートでの勝利',
    effectDesc: (lv) => `技・戦成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.3).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.j_jy || 0,
    step: 4
  },
  {
    id: 'brazil_ginga_dna',
    name: '【12歳留学】海外ジュニア留学ジンガ遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '海外ジュニアサッカー留学ルートでの勝利',
    effectDesc: (lv) => `技術成長 +${Math.min(5, lv) * 4}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.brazil_ryugaku || 0,
    step: 4
  },
  {
    id: 'world_acad_12_dna',
    name: '【上位進路】世界神童アカデミー遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '世界エリートアカデミー(12歳)での勝利',
    effectDesc: (lv) => `全成長 +${Math.min(5, lv) * 3}% / 全上限 +${(lv * 0.5).toFixed(1)}`,
    getStatVal: (s) => s.careerPathWins?.world_acad_12 || 0,
    step: 4
  },
  // --- 15歳高校期進路ゲノム ---
  {
    id: 'underdog_hero_dna',
    name: '【15歳進路】公立弱小校の三冠遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '地元公立弱小高校ルートでカップ優勝',
    effectDesc: (lv) => `全上限 +${(Math.min(5, lv) * 1.5 + Math.max(0, lv - 5) * 0.35).toFixed(2)} / 全戦力+${Math.min(5, lv) * 2}%`,
    getStatVal: (s) => s.careerUnderdogCups || 0,
    step: 2
  },
  {
    id: 'famous_youth_dna',
    name: '【15歳進路】名門王者の遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '名門Jユース・強豪校ルートでの勝利',
    effectDesc: (lv) => `全戦力 +${Math.min(5, lv) * 3}% / 全上限 +${(Math.max(0, lv - 5) * 0.3).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.elite_youth || 0,
    step: 5
  },
  {
    id: 'overseas_wild_dna',
    name: '【15歳留学】越境者の野性遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '欧州・南米アカデミー留学で出場',
    effectDesc: (lv) => `決・身成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerPathMatches?.overseas_acad || 0,
    step: 6
  },
  {
    id: 'spain_cantera_dna',
    name: '【15歳留学】ティキ・タカの遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: 'スペイン名門カンテラ留学で勝利',
    effectDesc: (lv) => `戦・技成長 +${Math.min(5, lv) * 4}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.spain_cantera || 0,
    step: 5
  },
  {
    id: 'galaxy_cantera_15_dna',
    name: '【上位進路】銀河系カンテラ遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '銀河系ユースカンテラ(15歳)での勝利',
    effectDesc: (lv) => `全戦力 +${Math.min(5, lv) * 3}% / 全上限 +${(lv * 0.6).toFixed(1)}`,
    getStatVal: (s) => s.careerPathWins?.galaxy_cantera_15 || 0,
    step: 5
  },
  // --- 18歳卒業後進路ゲノム ---
  {
    id: 'university_iq_dna',
    name: '【18歳進路】大卒知性派の遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '大学サッカー部ルートでの戦術・勝利（高能力でも選択可）',
    effectDesc: (lv) => `戦術成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerUniPoints || 0,
    step: 22
  },
  {
    id: 'jfl_hungry_dna',
    name: '【18歳進路】ハングリー精神の遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: 'JFL・社会人挑戦ルートでの勝利',
    effectDesc: (lv) => `身・決成長 +${Math.min(5, lv) * 3.5}% / 全上限 +${(Math.max(0, lv - 5) * 0.35).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.jfl_path || 0,
    step: 14
  },
  {
    id: 'young_pro_dna',
    name: '【18歳進路】若きプロフェッショナル遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: 'Jプロ契約ルートでの勝利',
    effectDesc: (lv) => `若手成長 +${Math.min(5, lv) * 5}% / 全上限 +${(Math.max(0, lv - 5) * 0.4).toFixed(2)}`,
    getStatVal: (s) => s.careerPathWins?.pro_direct || 0,
    step: 14
  },
  {
    id: 'euro_survival_dna',
    name: '【18歳留学】欧州サバイバル遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '欧州2部単身挑戦ルートでの勝利',
    effectDesc: (lv) => `全上限 +${(Math.min(5, lv) * 2.0 + Math.max(0, lv - 5) * 0.45).toFixed(2)} / 全戦力+${Math.min(5, lv) * 3}%`,
    getStatVal: (s) => s.careerPathWins?.euro_trial || 0,
    step: 14
  },
  {
    id: 'euro_top_18_dna',
    name: '【上位進路】欧州メガクラブ即戦力遺伝子',
    maxLv: 999,
    archiveAtLv: 5,
    isPathGenome: true,
    condition: '欧州メガクラブ即戦力契約(18歳)での勝利',
    effectDesc: (lv) => `全上限 +${(Math.min(5, lv) * 2.5 + Math.max(0, lv - 5) * 0.5).toFixed(2)} / 賞金+${Math.min(5, lv) * 5}%`,
    getStatVal: (s) => s.careerPathWins?.euro_top_18 || 0,
    step: 16
  }
];

// --- 融合ゲノム定義（100周目バランス調整） ---
const FUSED_GENOME_DEF = [
  {
    id: 'fused_fantasista',
    name: '【融合】至高のファンタジスタ遺伝子',
    parents: ['dribbler_dna', 'maestro_dna'],
    effectDesc: '全上限 +3 / 技術・戦術成長 +16% / 全試合戦力 +5%'
  },
  {
    id: 'fused_total_football',
    name: '【融合】トータルフットボール遺伝子',
    parents: ['engine_dna', 'allrounder_dna'],
    effectDesc: '全上限 +3 / 全試合戦力 +9% / 体力自然回復 +16%'
  },
  {
    id: 'fused_emperor',
    name: '【融合】絶対王者のストライカー遺伝子',
    parents: ['striker_dna', 'iron_will_dna'],
    effectDesc: '全上限 +4 / 決定戦力 +18% / 決定成長 +16%'
  },
  {
    id: 'fused_aegis',
    name: '【融合】難攻不落の守護神遺伝子',
    parents: ['guardian_dna', 'fortress_dna'],
    effectDesc: '全上限 +3 / 守備走力 +18% / 精神自然回復 +16%'
  },
  {
    id: 'fused_soulmate_hobby',
    name: '【融合】公私充実の黄金バランス遺伝子',
    parents: ['romance_bond_dna', 'hobby_master_dna'],
    effectDesc: '全上限 +5 / 全能力成長 +14% / 試合賞金 +18%'
  },
  {
    id: 'fused_eternal_king',
    name: '【融合】不滅のフットボール皇帝遺伝子',
    parents: ['king_eternal_dna', 'iron_will_dna'],
    effectDesc: '全上限 +7 / 引退寿命 +2歳 / 衰え減衰65%カット'
  },
  {
    id: 'fused_eternal_rival',
    name: '【融合】時代を創る双璧のカリスマ遺伝子',
    parents: ['rival_crusher_dna', 'media_star_dna'],
    effectDesc: '全上限 +6 / 格上・宿敵戦力 +18% / 獲得結晶 +12%'
  },
  {
    id: 'fused_titan',
    name: '【融合】巨神兵フィジカル遺伝子',
    parents: ['tall_body_dna', 'giant_body_dna'],
    effectDesc: '全上限 +4 / 身体・決定成長 +16% / 決定戦力 +10%'
  },
  {
    id: 'fused_complete_body',
    name: '【融合】究極肉体適応遺伝子',
    parents: ['agile_body_dna', 'balanced_body_dna'],
    effectDesc: '全上限 +5 / 全能力成長 +15% / 消費体力 -12%'
  },
  {
    id: 'fused_phoenix',
    name: '【融合】絆のチームリーダー遺伝子',
    parents: ['coach_mentor_dna', 'team_synergy_dna'],
    effectDesc: '全上限 +4 / 全試合戦力 +10% / 熟練度増加強化'
  },
  {
    id: 'fused_revolution',
    name: '【融合】地方創生・世界制覇遺伝子',
    parents: ['local_club_dna', 'world_champ_dna'],
    effectDesc: '全上限 +8 / 獲得継承結晶 +16% / 地元クラブ支援強化'
  },
  {
    id: 'fused_world_brain',
    name: '【融合】欧州制覇の戦術脳遺伝子',
    parents: ['euro_cc_dna', 'maestro_dna'],
    effectDesc: '全上限 +5 / 戦術・技術成長 +16% / 戦術Pt +20%'
  }
];

// --- 隠しゲノム定義（全4種） ---
const SECRET_GENOME_DEF = [
  {
    id: 'secret_small_giant',
    name: '【隠し】小さな巨人（162cm以下の守護壁）',
    hint: '小柄・俊敏型(162cm)でGKまたはCBとして公式戦15勝達成',
    effectDesc: '全上限 +3 / 守備走力 +24% / 技術成長 +12%'
  },
  {
    id: 'secret_sky_tower',
    name: '【隠し】天空のファンタジスタ（202cmの司令塔）',
    hint: '超大型(202cm)でOMFまたはWGとして通算25得点関与達成',
    effectDesc: '全上限 +3 / 攻撃・中盤戦力 +18% / 技術成長 +12%'
  },
  {
    id: 'secret_veteran_iron',
    name: '【隠し】不老のレジェンド魂（ベテランの輝き）',
    hint: '35歳以上の衰え期を迎えた後に公式戦15勝達成',
    effectDesc: '全上限 +3 / 寿命 +2歳 / 衰え期の減衰を半減'
  },
  {
    id: 'secret_time_master',
    name: '【隠し】時空を超えし求道者',
    hint: '総転生（タイムリープ）回数 8回以上に到達',
    effectDesc: '全上限 +4 / 獲得継承結晶 +20% / 全能力成長 +12%'
  }
];

// --- 戦術・遺伝子共鳴コンボ定義（全8種） ---
const SYNERGY_COMBOS_DEF = [
  {
    id: 'syn_giant_aerial',
    name: '【共鳴】空中戦の絶対支配',
    condText: '190cm以上 × CFまたはCB × 点取り屋/鉄壁DF Lv2以上',
    effectText: '決定・守備戦力 +16% ＆ ゴール期待値UP',
    check: (s) =>
      ['tall', 'giant'].includes(s.bodyType) &&
      ['CF', 'CB'].includes(s.position) &&
      ((s.genomes?.striker_dna || 0) >= 2 || (s.genomes?.fortress_dna || 0) >= 2)
  },
  {
    id: 'syn_agile_trickster',
    name: '【共鳴】神速のファンタジスタ',
    condText: '162cm小柄型 × WGまたはOMF × 閃光ドリブル Lv2以上',
    effectText: '技術成長 +22% ＆ ZONE溜まりやすさ +25%',
    check: (s) =>
      s.bodyType === 'agile' && ['WG', 'OMF'].includes(s.position) && (s.genomes?.dribbler_dna || 0) >= 2
  },
  {
    id: 'syn_total_orchestra',
    name: '【共鳴】中盤の完全支配オーケストラ',
    condText: 'CMFまたはOMF × 司令塔 Lv2以上 × 絆のお守り2個以上装備',
    effectText: '全試合戦力 +15% ＆ 戦術Pt獲得 +30%',
    check: (s) =>
      ['CMF', 'OMF'].includes(s.position) &&
      (s.genomes?.maestro_dna || 0) >= 2 &&
      (s.equippedCharms?.length || 0) >= 2
  },
  {
    id: 'syn_hometown_hero',
    name: '【共鳴】地方創生・魂のキャプテン',
    condText: '地元クラブLv3以上 × 同僚連携Lv4以上 × 蒼空FC遺伝子 Lv2以上',
    effectText: '試合賞金 +35% ＆ 獲得継承結晶 +20%',
    check: (s) =>
      (s.localClubLv || 1) >= 3 && (s.relations?.teamChem || 1) >= 4 && (s.genomes?.local_club_dna || 0) >= 2
  },
  {
    id: 'syn_iron_dynamo',
    name: '【共鳴】90分止まらぬ永久機関',
    condText: 'SBまたはGK × 無尽蔵の肺 Lv2以上 × 栄養弁当Lv5以上',
    effectText: '自然回復 +30% ＆ 練習消費体力 -18%',
    check: (s) =>
      ['SB', 'GK'].includes(s.position) &&
      (s.genomes?.engine_dna || 0) >= 2 &&
      (s.upgrades?.bento_protein || 0) >= 5
  },
  {
    id: 'syn_rival_eternal',
    name: '【共鳴】宿敵との黄金共闘',
    condText: '宿敵共闘タッグ解放済み × 好敵手凌駕 Lv2以上',
    effectText: '全試合戦力 +16% ＆ 格上戦力 +22%',
    check: (s) => Boolean(s.rivalCoopUnlocked) && (s.genomes?.rival_crusher_dna || 0) >= 2
  },
  {
    id: 'syn_gegen_beast',
    name: '【共鳴】狂気のハイプレス軍団',
    condText: '戦術「ゲーゲン・ハイプレス」 × 無尽蔵の肺 Lv2以上',
    effectText: 'ZONE溜まりやすさ +35% ＆ 攻撃戦力 +18%',
    check: (s) => s.tacticalStyle === 'gegenpress' && (s.genomes?.engine_dna || 0) >= 2
  },
  {
    id: 'syn_catenaccio_wall',
    name: '【共鳴】難攻不落のイタリアン要塞',
    condText: '戦術「カテナチオ」 × CBまたはGK × 鉄壁DF Lv2以上',
    effectText: '守備戦力 +28% ＆ 格上戦力 +18%',
    check: (s) =>
      s.tacticalStyle === 'catenaccio' && ['CB', 'GK'].includes(s.position) && (s.genomes?.fortress_dna || 0) >= 2
  }
];

// --- 5種トレーニング定義 ---
const DRILLS_DEF = [
  {
    id: 'tech_drill',
    cat: '技術',
    badgeClass: 'bg-sky-950 border-sky-600 text-sky-300',
    primaryStat: 'tec',
    baseStamCost: 3,
    baseMentCost: 0,
    expGain: 5,
    getAgeFlavor: (age, mLv) => {
      if (age < 12) {
        return mLv >= 6
          ? { title: '両足リフティング1000回', short: '技術特化' }
          : mLv >= 3
            ? { title: '対面パス＆トラップ基礎', short: '技術特化' }
            : { title: 'コーン・ドリブル鬼ごっこ', short: '技術特化' };
      }
      if (age < 18) {
        return mLv >= 8
          ? { title: '狭小グリッド3vs3崩し', short: '技術特化' }
          : mLv >= 4
            ? { title: '高速フェイント＆切り返し', short: '技術特化' }
            : { title: 'インサイド・アウトサイド反復', short: '技術特化' };
      }
      return mLv >= 10
        ? { title: '極限ゼロトラップ＆ターン', short: '技術特化' }
        : mLv >= 5
          ? { title: 'プレスの逆を取る重心移動', short: '技術特化' }
          : { title: 'ハイスピード技術サーキット', short: '技術特化' };
    }
  },
  {
    id: 'phy_drill',
    cat: '身体',
    badgeClass: 'bg-emerald-950 border-emerald-600 text-emerald-300',
    primaryStat: 'phy',
    baseStamCost: 4,
    baseMentCost: 0,
    expGain: 6,
    getAgeFlavor: (age, mLv) => {
      if (age < 12) {
        return mLv >= 6
          ? { title: 'ミニハードル俊敏ジャンプ', short: '身体・上限' }
          : mLv >= 3
            ? { title: 'ラダーステップ＆鬼ごっこ', short: '身体・上限' }
            : { title: '公園ダッシュ＆体幹バランス', short: '身体・上限' };
      }
      if (age < 18) {
        return mLv >= 8
          ? { title: 'シャトルラン＆スプリント反復', short: '身体・上限' }
          : mLv >= 4
            ? { title: '対人フィジカルコンタクト', short: '身体・上限' }
            : { title: '坂道ダッシュ＆体幹強化', short: '身体・上限' };
      }
      return mLv >= 10
        ? { title: '90分落ちない超回復走法', short: '身体・上限' }
        : mLv >= 5
          ? { title: '爆発的初速スプリント理論', short: '身体・上限' }
          : { title: 'プロ仕様インターバル走', short: '身体・上限' };
    }
  },
  {
    id: 'tactics_video',
    cat: '戦術',
    badgeClass: 'bg-indigo-950 border-indigo-600 text-indigo-300',
    primaryStat: 'iq',
    baseStamCost: 0,
    baseMentCost: 3,
    expGain: 5,
    getAgeFlavor: (age, mLv) => {
      if (age < 12) {
        return mLv >= 6
          ? { title: 'プロ試合TV録画の作戦研究', short: '戦術・Pt' }
          : mLv >= 3
            ? { title: '仲間の位置を見る首振り練習', short: '戦術・Pt' }
            : { title: 'サッカー絵本＆ルール勉強', short: '戦術・Pt' };
      }
      if (age < 18) {
        return mLv >= 8
          ? { title: '相手弱点分析＆ポジショニング', short: '戦術・Pt' }
          : mLv >= 4
            ? { title: 'ライン統率＆プレス連動', short: '戦術・Pt' }
            : { title: '戦術ボード基礎フォーメーション', short: '戦術・Pt' };
      }
      return mLv >= 10
        ? { title: 'ピッチ上の監督眼（3手先予測）', short: '戦術・Pt' }
        : mLv >= 5
          ? { title: '欧州トップ戦術アナライズ', short: '戦術・Pt' }
          : { title: 'プロ映像データスカウティング', short: '戦術・Pt' };
    }
  },
  {
    id: 'shoot_drill',
    cat: '決定',
    badgeClass: 'bg-rose-950 border-rose-600 text-rose-300',
    primaryStat: 'sht',
    baseStamCost: 5,
    baseMentCost: 1,
    expGain: 7,
    getAgeFlavor: (age, mLv) => {
      if (age < 12) {
        return mLv >= 6
          ? { title: '左右両足インステップ狙い撃ち', short: '決定力特化' }
          : mLv >= 3
            ? { title: 'ゴールの四隅を狙う的当て', short: '決定力特化' }
            : { title: '壁当てキック＆シュート遊び', short: '決定力特化' };
      }
      if (age < 18) {
        return mLv >= 8
          ? { title: 'クロスからのダイレクトボレー', short: '決定力特化' }
          : mLv >= 4
            ? { title: 'GKとの1対1冷静フィニッシュ', short: '決定力特化' }
            : { title: 'ペナルティエリア外ミドル砲', short: '決定力特化' };
      }
      return mLv >= 10
        ? { title: 'ワンタッチ決定機仕留め極意', short: '決定力特化' }
        : mLv >= 5
          ? { title: '無回転FK＆弾丸ボレー反復', short: '決定力特化' }
          : { title: '100本連続フィニッシュ特訓', short: '決定力特化' };
    }
  },
  {
    id: 'mental_image',
    cat: '精神',
    badgeClass: 'bg-amber-950 border-amber-600 text-amber-300',
    primaryStat: 'iq',
    secondaryStat: 'sht',
    baseStamCost: 0,
    baseMentCost: 4,
    expGain: 6,
    getAgeFlavor: (age, mLv) => {
      if (age < 12) {
        return mLv >= 6
          ? { title: '憧れのW杯優勝イメージ瞑想', short: '戦・決・精' }
          : mLv >= 3
            ? { title: '試合前の深呼吸ルーティン', short: '戦・決・精' }
            : { title: 'プロ選手の名言ノート書写', short: '戦・決・精' };
      }
      if (age < 18) {
        return mLv >= 8
          ? { title: 'PK戦の極限プレッシャー克服', short: '戦・決・精' }
          : mLv >= 4
            ? { title: '勝負強さを養うメンタル集中', short: '戦・決・精' }
            : { title: '雑念を消す瞑想トレーニング', short: '戦・決・精' };
      }
      return mLv >= 10
        ? { title: 'ゾーン意図的突入フロー法', short: '戦・決・精' }
        : mLv >= 5
          ? { title: '大舞台の集中呼吸メソッド', short: '戦・決・精' }
          : { title: 'プロメンタルトレーナー講義', short: '戦・決・精' };
    }
  }
];

// --- ブレイクスルー定義（ハイブリッド特性枠拡張追加・円単位コスト） ---
const BREAKTHROUGHS_DEF = [
  {
    id: 'batch_5x_train',
    name: '5倍集中トレ理論',
    tag: '永続効率',
    short: '1回で5回分まとめて練習＆成長！',
    desc: '一次転生しても消えない永続ブレイクスルー！手動・AUTOともに1回で5回分の練習を一気に消化し、爆発的に成長する。',
    costMoney: 24000,
    costTactics: 90
  },
  {
    id: 'smart_auto_all',
    name: '全自動AI&上限スキップ',
    tag: '永続自動',
    short: '買えば即全AUTO発動！回転+1回＆上限スキップ',
    desc: '解放した瞬間に全練習がAUTO ONになり、回転数+1回＆上限到達メニューを自動スキップ！',
    costMoney: 55000,
    costTactics: 190
  },
  {
    id: 'limit_break_manual',
    name: '限界突破の極意書',
    tag: '永続突破',
    short: '能力上限を超えた後の成長効率が2.5倍に上昇',
    desc: '才能上限に達した後の微成長効率を引き上げ、上限の壁を力技で押し広げられるようになる。',
    costMoney: 110000,
    costTactics: 360
  },
  {
    id: 'overcharge_body',
    name: '超回復150%突破',
    tag: '永続肉体',
    short: '体力・精神の上限を1.5倍までオーバーチャージ',
    desc: '最大体力・最大精神力の1.5倍まで蓄積できるようになり、長時間の連続トレーニングが止まらなくなる。',
    costMoney: 180000,
    costTactics: 580
  },
  {
    id: 'dense_schedule',
    name: '過密日程カレンダー',
    tag: '永続試合',
    short: '公式戦が毎月開催になり、勝利とゲノム獲得倍増',
    desc: '2ヶ月に1回だった公式戦が毎月開催され、試合経験・賞金・ゲノム蓄積スピードが2倍に加速する。',
    costMoney: 320000,
    costTactics: 880
  },
  {
    id: 'reincarnate_compass',
    name: '輪廻の羅針盤',
    tag: '永続転生',
    short: '獲得継承結晶 +25% ＆ 道具Lv半分引き継ぎ',
    desc: 'タイムリープ時に得られる継承結晶が25%増加し、さらに購入した道具レベルの半分を次の人生へ引き継ぐ！',
    costMoney: 520000,
    costTactics: 1350
  },
  {
    id: 'trait_slot_expander',
    name: '多面戦術神経回路（特性枠+1）',
    tag: '永続枠拡張',
    short: 'ハイブリッド特性の装備枠を永続で +1枠拡張！',
    desc: '複数ポジションのプレースタイル特性を同時に組み合わせて発動できる神業の神経回路を習得する。',
    costMoney: 950000,
    costTactics: 2400
  }
];

// --- 道具・自己投資アップグレード定義（円単位コスト・1個限定系は高額設定） ---
const UPGRADES_DEF = [
  {
    id: 'my_ball',
    name: 'マイボール＆練習板',
    baseG: 1800,
    basePt: 0,
    growth: 1.52,
    maxLv: 25,
    short: '技術成長 +8%/Lv',
    desc: '自宅での自主練の質を高め、技術トレーニングの成長量を伸ばす。'
  },
  {
    id: 'agility_gear',
    name: 'ラダー＆ミニハードル',
    baseG: 2400,
    basePt: 6,
    growth: 1.55,
    maxLv: 25,
    short: '身体成長 +8% & 体力上限+4/Lv',
    desc: '俊敏性と基礎体力を鍛え、身体成長量と最大体力を底上げする。'
  },
  {
    id: 'tactics_note',
    name: '戦術ノート＆映像集',
    baseG: 3000,
    basePt: 10,
    growth: 1.56,
    maxLv: 25,
    short: '戦術+8% & 戦術Pt+10% & 閃き+0.4%/Lv',
    desc: '試合映像を分析する習慣をつけ、戦術眼の伸びと戦術Pt獲得量・練習クリティカル率を高める。'
  },
  {
    id: 'bento_protein',
    name: '栄養弁当＆プロテイン',
    baseG: 3600,
    basePt: 10,
    growth: 1.56,
    maxLv: 25,
    short: '体力・精神自然回復 +12%/Lv',
    desc: '栄養バランスを整え、毎月の体力・精神力の回復速度を高める。'
  },
  {
    id: 'custom_spikes',
    name: '特注スパイク',
    // 足型を取って作る特注品。強豪校やユースに入って初めて縁ができる
    minCat: 4,
    baseG: 5000,
    basePt: 18,
    growth: 1.6,
    maxLv: 25,
    short: '決定成長 +8% & 全戦力+1.5%/Lv',
    desc: '足に完璧に馴染む特注スパイクでシュート精度と試合パフォーマンスを高める。'
  },
  {
    id: 'ai_schedule',
    name: 'AUTO高速ルーティン表',
    baseG: 12000,
    basePt: 35,
    growth: 2.35,
    maxLv: 5,
    short: 'AUTO枠+1＆自動ON・回転数+1回/Lv',
    desc: '買うたびにAUTO枠が増え即座に自動ON！さらにLvごとに毎月のAUTO連続実行回数が+1回ずつ重複加速する！'
  },
  {
    id: 'part_time',
    name: 'サッカーバイト・副業',
    minAge: 15,
    baseG: 4500,
    basePt: 14,
    growth: 1.6,
    maxLv: 20,
    short: '毎月定期収入 +1,200円/Lv',
    desc: 'スクール補助や用具整備のアルバイトで毎月の安定収入を得る（15歳以上解放）。'
  },
  {
    id: 'sponsor_deal',
    name: '個人スポンサー契約',
    // 本人の指摘（2026-11-26）:
    //   「2週目とかのまだ弱いときに個人スポンサーとかつかないと思う」
    // プロ契約（J3以上）＋ある程度の知名度がないと声は掛からない
    minCat: 9,
    minFans: 500,
    baseG: 18000,
    basePt: 50,
    growth: 1.72,
    maxLv: 20,
    short: '試合賞金 +12%/Lv',
    desc: 'メーカーや企業との個人契約により、公式戦勝利時の報酬が大きく増える（JFL以上解放）。'
  },
  {
    id: 'school_clinic',
    name: 'ジュニアクリニック主催',
    // 人を集めて教える以上、プロの肩書きが要る
    minAge: 18,
    minCat: 9,
    minFans: 2000,
    baseG: 30000,
    basePt: 80,
    growth: 1.8,
    maxLv: 15,
    short: '毎月戦術Pt+6 & ファン+10%/Lv',
    desc: '後進への指導を通じて自身の理解も深まり、毎月の戦術Ptとファンが増える（18歳以上解放）。'
  }
];

// --- 第1段階転生：継承結晶アップグレード定義（2x購入後にのみ4x解放・1個限定系は高額設定・特性枠拡張追加） ---
const LEGACY_UPGRADES_DEF = [
  {
    id: 'speed_2x',
    name: '【時間操作】倍速思考（2x速度解放）',
    tag: '時間操作',
    baseCost: 14,
    growth: 1.0,
    maxLv: 1,
    short: 'ゲーム進行速度「2x」を永久解放！',
    desc: '前世の記憶により思考と行動の無駄がなくなり、時間を2倍速で進められるようになる。'
  },
  {
    id: 'speed_4x',
    name: '【時間操作】超加速思考（4x速度解放）',
    tag: '時間操作',
    requiresId: 'speed_2x',
    baseCost: 42,
    growth: 1.0,
    maxLv: 1,
    short: '【2x解放後】ゲーム進行速度「4x」を永久解放！',
    desc: '極限の集中状態により、時間を4倍速で駆け抜けられるようになる（要:倍速思考2x）。'
  },
  {
    id: 'cap_breaker',
    name: '才能限界突破',
    baseCost: 20,
    growth: 1.12,
    maxLv: 120,
    short: '全能力の才能上限 +2/Lv（高Lvほど加速）',
    desc: '生まれ持った才能の器を押し広げ、全能力の成長上限を永続的に引き上げる。'
  },
  {
    id: 'growth_memory',
    name: 'タイムリープの記憶＆習慣継承',
    baseCost: 12,
    growth: 1.42,
    maxLv: 60,
    short: '全能力成長 +11% & 習慣熟練引き継ぎ+3%/Lv',
    desc: '前世で培った身体操作と練習習慣を記憶し、すべての練習効率と熟練引き継ぎ率を高める。'
  },
  {
    id: 'auto_drill_switcher',
    name: '【便利自動化】AI練習メニュー自動切替',
    tag: '操作削減',
    baseCost: 26,
    growth: 1.0,
    maxLv: 1,
    short: '買えば即発動！新練習解放＆上限到達時にAUTO枠を自動最適化',
    desc: '購入と同時に常時自動発動！未到達能力の練習を常に自動で選び続ける。'
  },
  {
    id: 'auto_gear_agent',
    name: '【便利自動化】専属マネージャー（道具自動購入）',
    tag: '操作削減',
    baseCost: 34,
    growth: 1.0,
    maxLv: 1,
    short: '買えば即発動！資金・戦術Ptで未MAX道具を毎月自動購入',
    desc: '購入と同時に自動購入がON！周回ごとの道具連打購入の手間をゼロにする。'
  },
  {
    id: 'auto_social_secretary',
    name: '【便利自動化】敏腕秘書（交流・師弟・装備自動消化）',
    tag: '操作削減',
    baseCost: 45,
    growth: 2.2,
    maxLv: 2,
    short: '買えば即発動！Lv1:宿敵・コーチ・師弟・装備 / Lv2:恋愛・メディア自動',
    desc: '購入と同時に自動消化がON！オフの交流アクションとお守り・特性の空き枠装備を毎月自動で消化。'
  },
  {
    id: 'trait_vessel_crystal',
    name: '【枠拡張】多才の記憶器（特性装備枠+1）',
    tag: '枠拡張',
    baseCost: 65,
    growth: 1.0,
    maxLv: 1,
    short: 'ハイブリッド特性の同時装備枠を +1枠拡張！',
    desc: '複数のポジション特性を同時に宿す記憶の器を魂に刻む。'
  },
  {
    id: 'iron_body',
    name: '鉄人の肉体遺伝子',
    baseCost: 12,
    growth: 1.5,
    maxLv: 15,
    short: '引退寿命 +2歳 & 初期体力 +8/Lv',
    desc: '怪我に強い強靭な肉体を手に入れ、現役寿命と初期最大体力を底上げする。'
  },
  {
    id: 'sharp_mind',
    name: '明晰な戦術脳',
    baseCost: 16,
    growth: 1.52,
    maxLv: 15,
    short: '初期精神 +8 & 戦術Pt獲得 +14%/Lv',
    desc: '5歳の頃からプロ顔負けの戦術眼を備え、精神上限と戦術Pt獲得量を高める。'
  },
  {
    id: 'club_connection',
    name: '支援者のコネクション',
    baseCost: 15,
    growth: 1.5,
    maxLv: 20,
    short: '初期資金 +6,000円 & 戦術Pt +20/Lv',
    desc: '支援者やスカウトとの縁を引き継ぎ、キャリア開始直後から潤沢な資金でスタートできる。'
  },
  {
    id: 'tactical_memory',
    name: '自動化の極意＆高速化',
    baseCost: 28,
    growth: 2.2,
    maxLv: 4,
    short: '初期AUTO枠+1 & AUTO実行回転+1回/Lv',
    desc: '周回開始直後からAUTOが自動ONになり、さらにLvごとに毎月のAUTO連続実行回数が+1回ずつ重複加速する！'
  },
  {
    id: 'market_memory',
    name: '相場と勝ち馬の記憶',
    baseCost: 26,
    growth: 1.5,
    maxLv: 12,
    short: '初期資金 ×1.8/Lv（倍率で効く）＆ 初期戦術Pt +15/Lv',
    desc: 'どの馬が勝ち、どの銘柄が跳ねたか。何度も同じ年を繰り返した人間にとって、それは予想ではなく記憶である。'
  },
  {
    id: 'patron_memory',
    name: '恩人の顔を覚えている',
    baseCost: 34,
    growth: 1.62,
    maxLv: 10,
    short: '15歳の春に支援金が一括で入る（Lvで大きくなる）',
    desc: '前の人生で世話になった人間を、まだ誰も知らないうちから訪ねられる。向こうは覚えていないが、こちらは覚えている。'
  },
  {
    id: 'charm_vessel',
    name: '絆の器（お守り枠拡張）',
    baseCost: 50,
    growth: 2.8,
    maxLv: 2,
    short: '絆のお守り装備枠 +1枠/Lv',
    desc: '人生のイベントで得た「絆のお守り」を同時に装備できる枠を増やす。'
  }
];

// 結晶強化をすべて最大まで買ったときの Lv 合計。
// 上位転生の解放条件がこれを超えると、何をしても次に進めなくなる。
// 本人報告（2026-11-23）:
//   「第一転生の強化アイテムの総数が足りず、すべてマックスに上げても
//     第二転生ができない状態になっている」
const MAX_LEGACY_LV_SUM = LEGACY_UPGRADES_DEF.reduce((a, u) => a + (u.maxLv || 0), 0);

// --- 上位転生（第2〜第5段階）聖杯アップグレード定義（8倍速追加！） ---
const ASCENSION_UPGRADES_DEF = [
  {
    id: 'divine_legacy_agent',
    name: '【神域自動化】輪廻の代理人（結晶強化を自動購入）',
    baseCost: 40,
    growth: 1.0,
    maxLv: 1,
    short: '買えば即発動！継承結晶が貯まるたび、買える強化を自動で買う',
    desc: '何十回も同じ買い物を繰り返した記憶が、意思を持ったように先回りして動く。結晶が貯まるそばから強化へ変わっていく。'
  },
  {
    id: 'divine_breakthrough_agent',
    name: '【神域自動化】覚醒の代理人（ブレイクスルーを自動購入）',
    baseCost: 55,
    growth: 1.0,
    maxLv: 1,
    short: '買えば即発動！資金と戦術Ptが足りる永続ブレイクスルーを自動習得',
    desc: '何を覚えるべきかはもう考えるまでもない。条件が揃った瞬間に、体の方が先に覚えている。'
  },
  {
    id: 'speed_8x',
    name: '【超神速】極限時間加速（8x速度解放）',
    baseCost: 45,
    growth: 1.0,
    maxLv: 1,
    short: 'ゲーム進行速度「8x」を永久解放！（超高速周回）',
    desc: '神域の集中力により時間の流れを8倍速へ引き上げ、圧倒的テンポで生涯を駆け抜ける。'
  },
  {
    id: 'divine_cap_multiplier',
    name: '神域・才能器倍率',
    baseCost: 3,
    growth: 1.35,
    maxLv: 25,
    short: '全能力上限の乗算倍率 +16%/Lv',
    desc: 'すべての能力上限値に乗算ボーナスをかけ、桁違いの領域へ到達させる。'
  },
  {
    id: 'divine_growth_overdrive',
    name: '天賦の学習速度',
    baseCost: 3,
    growth: 1.8,
    maxLv: 30,
    short: '全能力成長スピード +25%/Lv',
    desc: '練習1回あたりの成長量を乗算で増幅させ、成長期とともに一気に駆け上がる。'
  },
  {
    id: 'divine_crystal_harvest',
    name: '輪廻結晶の錬成炉',
    baseCost: 4,
    growth: 1.95,
    maxLv: 20,
    short: 'タイムリープ獲得結晶 +28%/Lv',
    desc: '一次転生時に得られる継承結晶の量を大幅に増幅する。'
  },
  {
    id: 'divine_auto_overdrive',
    name: '神速タイムフロー',
    baseCost: 6,
    growth: 2.35,
    maxLv: 8,
    short: 'AUTO連続回転 +1回 & 全試合戦力 +10%/Lv',
    desc: '毎月のAUTO練習回転数と試合全戦力を同時に引き上げる神域スキル。'
  },
  {
    id: 'divine_charm_slot',
    name: '超越者の聖櫃',
    baseCost: 12,
    growth: 3.0,
    maxLv: 1,
    short: '絆のお守り装備枠 +1枠 & 特性装備枠 +1枠',
    desc: '魂に刻める絆のお守り枠とプレースタイル特性枠をそれぞれ1枠拡張する。'
  },
  {
    id: 'cosmic_protege_sync',
    name: '【宇宙評議会】師弟超共鳴リンク',
    minAsc: 4,
    baseCost: 15,
    growth: 2.2,
    maxLv: 10,
    short: '師弟連携効果 +35% & 全成長 +22%/Lv',
    desc: '第5段階転生で解放される宇宙評議会の秘術。愛弟子との魂の同調率を極限まで高める。'
  },
  {
    id: 'cosmic_genesis_engine',
    name: '【宇宙評議会】無限銀河エンジン',
    minAsc: 4,
    baseCost: 18,
    growth: 2.4,
    maxLv: 10,
    short: '初期能力 +25/Lv & 全試合戦力 +22%/Lv',
    desc: '成人後に宇宙レベルの基礎能力を発揮し、銀河評議会の頂点へ駆け上がる。'
  }
];

// --- 上位転生後のエンドコンテンツ試練（全6種：未達成はシークレット表示！） ---
const ENDGAME_TRIALS_DEF = [
  {
    id: 'trial_teen_j1',
    name: '【神域試練I】15歳未満のJ1制覇',
    desc: '15歳未満の年齢でJ1リーグカテゴリへ到達する',
    rewardText: '永続報酬：全能力成長 +20%',
    check: (s) => (s.ascensionCount || 0) >= 1 && s.age < 15 && s.categoryId >= 11
  },
  {
    id: 'trial_euro_beast',
    name: '【神域試練II】欧州4大リーグ全制覇',
    desc: '欧州4ヶ国すべてで熟練Lv.2以上を達成する',
    rewardText: '永続報酬：獲得継承結晶 +15%',
    check: (s) => {
      if ((s.ascensionCount || 0) < 1) return false;
      const em = s.euroMastery || {};
      return ['england', 'spain', 'italy', 'france'].every((c) => Math.floor((em[c] || 0) / 10) >= 2);
    }
  },
  {
    id: 'trial_cc_triple',
    name: '【神域試練III】18歳未満で欧州CC覇者',
    desc: '18歳未満で欧州チャンピオンカップ強豪カテゴリに到達する',
    rewardText: '永続報酬：全能力上限 +16',
    check: (s) => (s.ascensionCount || 0) >= 1 && s.age < 18 && s.categoryId >= 13
  },
  {
    id: 'trial_local_god',
    name: '【神域試練IV】地元クラブ世界王者',
    desc: '蒼空FCの育成Lvを最大(Lv.7)まで引き上げる',
    rewardText: '永続報酬：蒼空FC援護戦力 ×1.5倍',
    check: (s) => (s.ascensionCount || 0) >= 1 && (s.localClubLv || 1) >= 7
  },
  {
    id: 'trial_genesis_god',
    name: '【神域試練V】フットボールの創世神',
    desc: '最高カテゴリ「フットボールの創世神」に到達する',
    rewardText: '永続報酬：全試合戦力 +25% ＆ 全能力上限 +40',
    check: (s) => (s.ascensionCount || 0) >= 1 && s.categoryId >= 16
  },
  {
    id: 'trial_cosmic_council',
    name: '【宇宙試練VI】宇宙フットボール評議会・最高神',
    desc: '第5段階転生後に最終カテゴリ「宇宙フットボール評議会・最高神」へ到達する',
    rewardText: '永続報酬：全能力成長 +60% ＆ 全能力上限 +140',
    check: (s) => (s.ascensionCount || 0) >= 4 && s.categoryId >= 18
  }
];


// --- ライフステージ・衰え期判定 ---
const getCareerStageInfo = (age, maxRetireAge) => {
  if (age <= 11) return { label: 'キッズ期', isDecay: false, growthMult: 1.04 };
  if (age <= 17) return { label: 'ユース期', isDecay: false, growthMult: 1.16 };
  if (age <= 23) return { label: '若手飛躍期', isDecay: false, growthMult: 1.25 };
  if (age <= 29) return { label: '全盛期', isDecay: false, growthMult: 1.15 };
  // 30歳以降は急激に鈍る。粘っても伸びないので、
  // 早めに引退して次の周回へ行く方が得になる（早期引退のインセンティブ）。
  // 現役を続けたいなら継承結晶で寿命を買う、という役割分担にする。
  // docs/GAME_DESIGN.md §15-1
  const decayYears = age - 29;
  return {
    label: `伸び悩み期(${decayYears}年目 / 限界${maxRetireAge}歳)`,
    isDecay: true,
    growthMult: Math.max(0.12, 1 - decayYears * 0.2)
  };
};

// --- 年齢連動のリアルタイム身長 ---
const getDynamicHeight = (age, targetHeight) => {
  if (age >= 18) return targetHeight;
  const startH = 108;
  const progress = Math.max(0, Math.min(1, (age - 5) / 13));
  return Math.round(startH + (targetHeight - startH) * Math.pow(progress, 0.85));
};

// --- チーム内序列 ---
const getSquadRoleInfo = (rating, categoryId) => {
  const baseReq = Math.max(3, CATEGORIES[categoryId]?.reqRating || 3);
  const ratio = rating / baseReq;
  if (ratio >= 1.55) return { title: '絶対的エース', badge: 'bg-amber-950 border-amber-500 text-amber-300' };
  if (ratio >= 1.2) return { title: '主力レギュラー', badge: 'bg-emerald-950 border-emerald-500 text-emerald-300' };
  if (ratio >= 0.95) return { title: 'スタメン定着', badge: 'bg-sky-950 border-sky-500 text-sky-300' };
  if (ratio >= 0.72) return { title: 'ベンチ入り', badge: 'bg-slate-800 border-slate-600 text-slate-300' };
  return { title: '練習生・補欠', badge: 'bg-slate-900 border-slate-700 text-slate-400' };
};

// --- 習慣熟練度マイルストーン倍率 ---
const getHabitMilestoneMult = (mLv, completedChallenges = []) => {
  const ch7Mult = completedChallenges.includes('ch_no_memory') ? 1.6 : 1.0;
  let base = 1 + mLv * 0.025;
  if (mLv >= 50) base *= 2.6;
  else if (mLv >= 35) base *= 2.0;
  else if (mLv >= 20) base *= 1.6;
  else if (mLv >= 10) base *= 1.3;
  else if (mLv >= 5) base *= 1.12;
  return base * ch7Mult;
};

// --- 総合力計算 ---
const getTotalRating = (s) => {
  const { tec, phy, iq, sht } = s.stats;
  return Number((tec + phy + iq + sht).toFixed(1));
};

// --- 実効最大体力・精神（オーバーチャージ対応） ---
const getEffectiveMaxResources = (s) => {
  const ocMult = s.breakthroughs?.overcharge_body ? 1.5 : 1.0;
  return {
    effMaxStam: Math.round(s.maxStamina * ocMult),
    effMaxMent: Math.round(s.maxMental * ocMult)
  };
};

// --- 発動中の共鳴コンボ取得 ---
const getActiveSynergies = (s) => {
  return SYNERGY_COMBOS_DEF.filter((syn) => {
    try {
      return syn.check(s);
    } catch (e) {
      return false;
    }
  });
};

// --- お守り＆特性最大装備枠計算（超過分は自動解除するヘルパーも併設） ---
const computeMaxCharmSlots = (legacyUpgrades = {}, ascensionUpgrades = {}, genomes = {}) => {
  const base = 1;
  const vesselBonus = legacyUpgrades.charm_vessel || 0;
  const divineBonus = ascensionUpgrades.divine_charm_slot || 0;
  const loveBonus = (genomes.romance_bond_dna || 0) >= 5 ? 1 : 0;
  return Math.min(5, base + vesselBonus + divineBonus + loveBonus);
};

const computeMaxTraitSlots = (
  ascensionCount = 0,
  ascensionUpgrades = {},
  legacyUpgrades = {},
  breakthroughs = {}
) => {
  return Math.min(
    6,
    2 +
      (ascensionCount >= 1 ? 1 : 0) +
      (ascensionUpgrades.divine_charm_slot || 0) +
      (legacyUpgrades.trait_vessel_crystal || 0) +
      (breakthroughs.trait_slot_expander ? 1 : 0)
  );
};

const clampEquippedLists = (s) => {
  const maxC = computeMaxCharmSlots(s.legacyUpgrades, s.ascensionUpgrades, s.genomes);
  const maxT = computeMaxTraitSlots(s.ascensionCount || 0, s.ascensionUpgrades, s.legacyUpgrades, s.breakthroughs);
  s.maxCharmSlots = maxC;
  s.maxTraitSlots = maxT;
  if (Array.isArray(s.equippedCharms) && s.equippedCharms.length > maxC) {
    s.equippedCharms = s.equippedCharms.slice(0, maxC);
  }
  if (Array.isArray(s.equippedTraits) && s.equippedTraits.length > maxT) {
    s.equippedTraits = s.equippedTraits.slice(0, maxT);
  }
};

// --- 個別能力上限計算（「頭脳は大人・体は子供」年齢発育リミッター搭載＆100周目バランス） ---
const computeIndividualStatCaps = (
  generation,
  legacyUpgrades = {},
  achievements = [],
  position = 'CF',
  bodyType = 'balanced',
  genomes = {},
  fusedGenomes = [],
  secretGenomes = [],
  ascensionUpgrades = {},
  endlessInvest = {},
  posEventCaps = { tec: 0, phy: 0, iq: 0, sht: 0 },
  rivalPerkCaps = { tec: 0, phy: 0, iq: 0, sht: 0 },
  completedTrials = [],
  ascensionCount = 0,
  unlockedEndings = [],
  completedChallenges = [],
  activeChallenge = null,
  protegeBonds = {},
  age = 18
) => {
  const isFirstGen = generation === 1 && ascensionCount === 0;
  const baseCap = isFirstGen ? 6.2 : 7.0 * Math.pow(GENERATION_CAP_GROWTH, generation - 2);
  // 才能限界突破は Lv が上がるほど1Lvの効き方が大きくなる（累進）。
  // 線形 +2.0/Lv だと、コストが指数で伸びるのに効果が線形なので
  // 必ずどこかで死ぬ。実測でも買う価値がなかった（docs/BALANCE_LOG.md ⑦⑧）。
  const capBreakerLv = legacyUpgrades.cap_breaker || 0;
  const breakerBonus = capBreakerLv * 2.0 + Math.pow(capBreakerLv, 1.7) * 0.5;
  const underdogBonus = Math.min(5, genomes.underdog_hero_dna || 0) * 1.5;
  const euroSurvivalBonus = Math.min(5, genomes.euro_survival_dna || 0) * 2.0;
  const worldAcad12Bonus = Math.min(5, genomes.world_acad_12_dna || 0) * 1.5;
  const galaxyCantera15Bonus = Math.min(5, genomes.galaxy_cantera_15_dna || 0) * 1.8;
  const euroTop18Bonus = Math.min(5, genomes.euro_top_18_dna || 0) * 2.5;
  const protegeBonus = (genomes.protege_bond_dna || 0) * 1.5;
  const childBonus =
    (genomes.child_son_prodigy_dna || 0) * 1.5 + (genomes.child_daughter_genius_dna || 0) * 1.5;

  const isProtegeComp = Object.keys(PROTEGE_ARCHETYPES).every((id) => (protegeBonds?.[id] || 0) >= 5);
  const protegeCompCap = isProtegeComp ? 18 : 0;

  const pathOvercapBonus =
    Math.max(0, (genomes.jr_local_dna || 0) - 5) * 0.25 +
    Math.max(0, (genomes.jr_elite_dna || 0) - 5) * 0.3 +
    Math.max(0, (genomes.jr_abroad_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.grassroots_dna || 0) - 5) * 0.3 +
    Math.max(0, (genomes.regional_jhs_dna || 0) - 5) * 0.3 +
    Math.max(0, (genomes.j_elite_dna || 0) - 5) * 0.3 +
    Math.max(0, (genomes.brazil_ginga_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.world_acad_12_dna || 0) - 5) * 0.5 +
    Math.max(0, (genomes.underdog_hero_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.famous_youth_dna || 0) - 5) * 0.3 +
    Math.max(0, (genomes.overseas_wild_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.spain_cantera_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.galaxy_cantera_15_dna || 0) - 5) * 0.6 +
    Math.max(0, (genomes.university_iq_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.jfl_hungry_dna || 0) - 5) * 0.35 +
    Math.max(0, (genomes.young_pro_dna || 0) - 5) * 0.4 +
    Math.max(0, (genomes.euro_survival_dna || 0) - 5) * 0.45 +
    Math.max(0, (genomes.euro_top_18_dna || 0) - 5) * 0.5;

  const totalPlayerBonus = (genomes.total_player_dna || 0) * 1.2;
  const mediaStarBonus = (genomes.media_star_dna || 0) * 1.2;
  const familyGuardBonus = (genomes.family_guardian_dna || 0) * 1.6;
  const euroCcBonus = (genomes.euro_cc_dna || 0) * 2.5;
  const endlessLabCap = (endlessInvest?.endless_lab || 0) * 0.35;
  const endingCapBonus =
    (unlockedEndings.includes('ed_euro_king') ? 14 : 0) + (unlockedEndings.includes('ed_parent_child') ? 20 : 0);
  const ch4CapBonus = completedChallenges.includes('ch_half_cap') ? 40 : 0;
  const ch8CapBonus = completedChallenges.includes('ch_ascetic_god') ? 120 : 0;

  let fusedBonus = 0;
  if (fusedGenomes.includes('fused_fantasista')) fusedBonus += 3;
  if (fusedGenomes.includes('fused_total_football')) fusedBonus += 3;
  if (fusedGenomes.includes('fused_emperor')) fusedBonus += 4;
  if (fusedGenomes.includes('fused_aegis')) fusedBonus += 3;
  if (fusedGenomes.includes('fused_soulmate_hobby')) fusedBonus += 5;
  if (fusedGenomes.includes('fused_eternal_king')) fusedBonus += 7;
  if (fusedGenomes.includes('fused_eternal_rival')) fusedBonus += 6;
  if (fusedGenomes.includes('fused_titan')) fusedBonus += 4;
  if (fusedGenomes.includes('fused_complete_body')) fusedBonus += 5;
  if (fusedGenomes.includes('fused_phoenix')) fusedBonus += 4;
  if (fusedGenomes.includes('fused_revolution')) fusedBonus += 8;
  if (fusedGenomes.includes('fused_world_brain')) fusedBonus += 5;

  let secretBonus = 0;
  if (secretGenomes.includes('secret_small_giant')) secretBonus += 3;
  if (secretGenomes.includes('secret_sky_tower')) secretBonus += 3;
  if (secretGenomes.includes('secret_veteran_iron')) secretBonus += 3;
  if (secretGenomes.includes('secret_time_master')) secretBonus += 4;

  const achBonus =
    (achievements.includes('youth_elite') ? 2 : 0) +
    (achievements.includes('j_leaguer') ? 3 : 0) +
    (achievements.includes('overseas') ? 5 : 0);

  const trialCapBonus =
    (completedTrials.includes('trial_cc_triple') ? 16 : 0) +
    (completedTrials.includes('trial_genesis_god') ? 40 : 0) +
    (completedTrials.includes('trial_cosmic_council') ? 140 : 0);

  const rawPool =
    baseCap +
    breakerBonus +
    underdogBonus +
    euroSurvivalBonus +
    worldAcad12Bonus +
    galaxyCantera15Bonus +
    euroTop18Bonus +
    protegeBonus +
    childBonus +
    protegeCompCap +
    pathOvercapBonus +
    totalPlayerBonus +
    mediaStarBonus +
    familyGuardBonus +
    euroCcBonus +
    endlessLabCap +
    endingCapBonus +
    ch4CapBonus +
    ch8CapBonus +
    fusedBonus +
    secretBonus +
    achBonus +
    trialCapBonus;

  // 段階ごとの能力上限の倍率。
  // 本人の意図は「第三転生で完全無双」なので、1段階ごとに約2.8倍ずつ。
  // 旧値（1.15 / 1.4 / 1.9 / 2.8）では第2転生のリターンが +15% しかなく、
  // 9周かけて転生前の1.4倍にしかならなかった。
  const stageMult =
    ascensionCount >= 4
      ? 60
      : ascensionCount >= 3
        ? 20
        : ascensionCount >= 2
          ? 7.0
          : ascensionCount >= 1
            ? 2.5
            : 1.0;
  const divineMult = 1 + (ascensionUpgrades.divine_cap_multiplier || 0) * 0.16;
  const ch4Penalty = activeChallenge === 'ch_half_cap' ? 0.5 : 1.0;

  // 30歳以降は「才能の器」そのものが縮む。
  //
  // 以前は能力値だけを毎月わずかに削っていたので、AUTO練習がその削りを
  // 即座に取り返してしまい、58歳・63歳・80歳まで現役が続いていた（実測）。
  // 本人指摘（2026-11-23）:
  //   「2週目時点で、もろもろの自動強化が加齢の能力低下を上回り、
  //     80歳までプレーできてしまった。身体能力は加齢するほど加速度的に低下するようにしろ」
  //
  // 上限そのものを落とせば、練習しても上限超過の逓減（overCapDiminishing）が
  // 効いて伸びなくなる。衰えを「取り返せないもの」にするのが狙い。
  //   35歳 ×0.41 / 40歳 ×0.15 / 45歳 ×0.05
  // 衰え緩和（隠しゲノム・king_eternal・融合・ED5・CH5）を全部積むと
  // 指数の肩が 0.12 まで緩み、50歳でも ×0.60 を保てる。
  const decaySoften = Math.max(
    0.12,
    (secretGenomes.includes('secret_veteran_iron') ? 0.6 : 1.0) *
      Math.max(0.3, 1 - (genomes.king_eternal_dna || 0) * 0.1) *
      (fusedGenomes.includes('fused_eternal_king') ? 0.45 : 1.0) *
      (unlockedEndings.includes('ed_eternal_50') ? 0.75 : 1.0) *
      (completedChallenges.includes('ch_twilight_32') ? 0.6 : 1.0)
  );
  const ageCapMult =
    age <= 29 ? 1.0 : Math.max(0.006, Math.pow(0.91, Math.pow(age - 29, 1.25) * decaySoften));

  const pool = rawPool * stageMult * divineMult * ch4Penalty * ageCapMult;

  const bodyGrowthLimiter =
    age >= 18 ? 1.0 : age >= 15 ? 0.65 : age >= 12 ? 0.36 : age >= 8 ? 0.2 : 0.14;
  const brainLimiter = age >= 15 ? 1.0 : age >= 12 ? 0.85 : 0.72;

  const pos = POSITIONS[position] || POSITIONS.CF;
  const body = BODY_TYPES[bodyType] || BODY_TYPES.balanced;
  const giantPhyExtra = (genomes.giant_body_dna || 0) * 1.5 * ch4Penalty;

  // 30歳を超えたら最低保証を外す。
  //
  // 保証が 3/3/4/3 あると、どれだけ衰えても総合力が 13 残る。
  // 地域ジュニアの要求（6.5）を永久に超え続けるので契約が切れず、
  // 実測で 58歳・63歳まで現役が続いていた（docs/BALANCE_LOG.md ⑮）。
  const floorBody = age >= 30 ? 1 : 3;
  const floorIq = age >= 30 ? 1 : 4;

  // ポジションイベント・宿敵パークの永続加算にも加齢を効かせる。
  // ここだけ pool の外にあると、周回を重ねた人ほど歳を取っても落ちなくなり、
  // 「60歳の銀河系リーガー」が復活する。
  const permCap = (v) => (v || 0) * ageCapMult;

  return {
    tec: Math.max(
      floorBody,
      Math.round(
        (pool * pos.capRatio.tec * body.capMult.tec + permCap(posEventCaps.tec) + permCap(rivalPerkCaps.tec)) *
          bodyGrowthLimiter
      )
    ),
    phy: Math.max(
      floorBody,
      Math.round(
        (pool * pos.capRatio.phy * body.capMult.phy +
          giantPhyExtra * ageCapMult +
          permCap(posEventCaps.phy) +
          permCap(rivalPerkCaps.phy)) *
          bodyGrowthLimiter
      )
    ),
    iq: Math.max(
      floorIq,
      Math.round(
        (pool * pos.capRatio.iq * body.capMult.iq + permCap(posEventCaps.iq) + permCap(rivalPerkCaps.iq)) *
          brainLimiter
      )
    ),
    sht: Math.max(
      floorBody,
      Math.round(
        (pool * pos.capRatio.sht * body.capMult.sht + permCap(posEventCaps.sht) + permCap(rivalPerkCaps.sht)) *
          bodyGrowthLimiter
      )
    )
  };
};

// --- 限界超過時の段階的逓減成長計算 ---
const applyStatGrowth = (s, key, rawDelta) => {
  const cur = s.stats[key] || 0;
  const cap = s.statCaps[key] || 10;
  const hasBreak = Boolean(s.breakthroughs?.limit_break_manual);
  const ch4OverMult = s.completedChallenges?.includes('ch_half_cap') ? 2.5 : 1.0;
  const baseOverRatio = overCapRatio(hasBreak, ch4OverMult);

  if (cur + rawDelta <= cap) {
    s.stats[key] = Number((cur + rawDelta).toFixed(4));
    return rawDelta;
  }

  let gain = 0;
  let rem = rawDelta;
  let val = cur;

  if (val < cap) {
    const under = cap - val;
    gain += under;
    val = cap;
    rem -= under;
  }

  const diminishing = overCapDiminishing(val, cap);
  const overGain = rem * baseOverRatio * diminishing;
  gain += overGain;
  s.stats[key] = Number((val + overGain).toFixed(4));
  return gain;
};

// --- 練習1回あたりのリアルタイム実効消費＆予想成長量を算出 ---
const getDrillEffectiveStats = (s, drill) => {
  const body = BODY_TYPES[s.bodyType] || BODY_TYPES.balanced;
  const tStyle = TACTICAL_STYLES[s.tacticalStyle] || TACTICAL_STYLES.balanced;
  const g = s.genomes || {};
  const fused = s.fusedGenomes || [];
  const syns = getActiveSynergies(s);
  const traits = s.equippedTraits || [];

  const stamDiscount = Math.max(
    0.45,
    body.stamCostMult *
      tStyle.stamCostMult *
      (1 - (g.agile_body_dna || 0) * 0.015) *
      (fused.includes('fused_complete_body') ? 0.88 : 1.0) *
      (s.equippedCharms?.includes('charm_lover') ? 0.92 : 1.0) *
      (traits.includes('trait_cmf') ? 0.9 : 1.0) *
      (syns.some((x) => x.id === 'syn_iron_dynamo') ? 0.82 : 1.0)
  );
  const effStam = drill.baseStamCost > 0 ? Math.max(1, Math.round(drill.baseStamCost * stamDiscount)) : 0;
  const effMent = drill.baseMentCost > 0 ? Math.max(1, Math.round(drill.baseMentCost * stamDiscount)) : 0;

  const isBtBanned = s.activeChallenge === 'ch_no_memory' || s.activeChallenge === 'ch_ascetic_god';
  const isGearBanned = s.activeChallenge === 'ch_no_gear' || s.activeChallenge === 'ch_ascetic_god';
  const isSoloCarry = s.activeChallenge === 'ch_solo_carry' || s.activeChallenge === 'ch_ascetic_god';

  const reps = !isBtBanned && s.breakthroughs?.batch_5x_train ? 5 : 1;
  const stage = getCareerStageInfo(s.age, s.maxRetireAge);
  const memLv = s.legacyUpgrades?.growth_memory || 0;
  const u = isGearBanned ? {} : s.upgrades || {};
  const hb = s.hobbies || {};
  const secret = s.secretGenomes || [];
  const pObj = s.life?.married ? PARTNER_TYPES[s.life.partnerType] : null;
  const turfLv = isSoloCarry ? 0 : s.clubFacilities?.fac_turf || 0;
  const protegeObj = s.protege?.archetypeId ? PROTEGE_ARCHETYPES[s.protege.archetypeId] : null;
  const protegeBondLv = s.protege?.bondLv || 0;
  const cosmicProtegeMult = 1 + (s.ascensionUpgrades?.cosmic_protege_sync || 0) * 0.22;

  const rawGlobalMult =
    (1 + memLv * 0.11) *
    (1 + (s.ascensionUpgrades?.divine_growth_overdrive || 0) * 0.25) *
    cosmicProtegeMult *
    (1 + (g.balanced_body_dna || 0) * 0.02) *
    (1 + (g.allrounder_dna || 0) * 0.015) *
    (1 + (g.romance_bond_dna || 0) * 0.02) *
    (1 + (g.hobby_master_dna || 0) * 0.015) *
    (1 + (g.world_champ_dna || 0) * 0.03) *
    (1 + (g.jr_abroad_dna || 0) * 0.035) *
    (1 + (g.world_acad_12_dna || 0) * 0.03) *
    (1 + (g.child_daughter_genius_dna || 0) * 0.03) *
    (1 + turfLv * 0.035) *
    (1 + (s.endlessInvest?.endless_ai || 0) * 0.025) *
    (pObj?.id === 'childhood' ? 1.05 : 1.0) *
    (s.age <= 20 ? 1 + Math.min(5, g.young_pro_dna || 0) * 0.05 : 1.0) *
    (fused.includes('fused_soulmate_hobby') ? 1.14 : 1.0) *
    (fused.includes('fused_complete_body') ? 1.15 : 1.0) *
    (secret.includes('secret_time_master') ? 1.12 : 1.0) *
    (s.equippedCharms?.includes('charm_rival') ? 1.06 : 1.0) *
    (s.equippedCharms?.includes('charm_champion') ? 1.1 : 1.0) *
    (s.rivalCoopUnlocked ? 1.08 : 1.0) *
    (s.completedTrials?.includes('trial_teen_j1') ? 1.2 : 1.0) *
    (s.completedTrials?.includes('trial_cosmic_council') ? 1.6 : 1.0) *
    (s.unlockedEndings?.includes('ed_j_legend') ? 1.12 : 1.0) *
    (s.unlockedEndings?.includes('ed_cosmic_god') ? 1.4 : 1.0) *
    (s.completedChallenges?.includes('ch_no_gear') ? 1.35 : 1.0) *
    ((s.zoneFeverMonths || 0) > 0 ? 2.2 : 1.0) *
    stage.growthMult;

  // 要素を全部揃えたときの指数爆発を抑える（src/lib/softcap.js）。
  // 実挙動側（executeDrillInternal）と必ず同じ式にすること。
  const globalMult = softcap(rawGlobalMult, GROWTH_SOFTCAP.threshold, GROWTH_SOFTCAP.strength);

  const ch2BodyTecMult = s.completedChallenges?.includes('ch_pure_body') ? 1.2 : 1.0;

  let specMult = 1.0;
  if (drill.primaryStat === 'tec') {
    specMult =
      (1 + (u.my_ball || 0) * 0.08) *
      (1 + (g.dribbler_dna || 0) * 0.025) *
      (1 + (g.maestro_dna || 0) * 0.025) *
      (1 + (g.jr_elite_dna || 0) * 0.04) *
      (1 + (g.j_elite_dna || 0) * 0.035) *
      (1 + (g.brazil_ginga_dna || 0) * 0.04) *
      (1 + (g.spain_cantera_dna || 0) * 0.04) *
      (1 + (g.agile_body_dna || 0) * 0.03) *
      (protegeObj?.id === 'soma' ? 1 + protegeBondLv * 0.03 : 1.0) *
      (fused.includes('fused_fantasista') ? 1.16 : 1.0) *
      (fused.includes('fused_world_brain') ? 1.16 : 1.0) *
      (secret.includes('secret_small_giant') || secret.includes('secret_sky_tower') ? 1.12 : 1.0) *
      (traits.includes('trait_wg') ? 1.1 : 1.0) *
      (syns.some((x) => x.id === 'syn_agile_trickster') ? 1.22 : 1.0) *
      ch2BodyTecMult;
  } else if (drill.primaryStat === 'phy') {
    specMult =
      (1 + (u.agility_gear || 0) * 0.08) *
      (1 + (g.regional_jhs_dna || 0) * 0.035) *
      (1 + (g.overseas_wild_dna || 0) * 0.035) *
      (1 + (g.jfl_hungry_dna || 0) * 0.035) *
      (1 + (g.tall_body_dna || 0) * 0.03) *
      (pObj?.id === 'athlete' ? 1.07 : 1.0) *
      (fused.includes('fused_titan') ? 1.16 : 1.0) *
      ch2BodyTecMult;
  } else if (drill.primaryStat === 'iq') {
    specMult =
      (1 + (u.tactics_note || 0) * 0.08) *
      (1 + (hb.chess || 0) * 0.05) *
      (1 + (g.maestro_dna || 0) * 0.025) *
      (1 + (g.university_iq_dna || 0) * 0.035) *
      (1 + (g.coach_mentor_dna || 0) * 0.03) *
      (1 + (g.j_elite_dna || 0) * 0.035) *
      (1 + (g.spain_cantera_dna || 0) * 0.04) *
      (protegeObj?.id === 'soma' ? 1 + protegeBondLv * 0.03 : 1.0) *
      (s.equippedCharms?.includes('charm_coach') ? 1.1 : 1.0) *
      (fused.includes('fused_fantasista') ? 1.16 : 1.0) *
      (fused.includes('fused_world_brain') ? 1.16 : 1.0);
  } else if (drill.primaryStat === 'sht') {
    specMult =
      (1 + (u.custom_spikes || 0) * 0.08) *
      (1 + (g.striker_dna || 0) * 0.025) *
      (1 + (g.regional_jhs_dna || 0) * 0.035) *
      (1 + (g.overseas_wild_dna || 0) * 0.035) *
      (1 + (g.jfl_hungry_dna || 0) * 0.035) *
      (1 + (g.tall_body_dna || 0) * 0.03) *
      (fused.includes('fused_emperor') ? 1.16 : 1.0) *
      (fused.includes('fused_titan') ? 1.16 : 1.0);
  }

  const mLv = Math.floor((s.mastery?.[drill.id] || 0) / 30);
  const masteryBonus = getHabitMilestoneMult(mLv, s.completedChallenges || []);
  const additivePool = Math.min(2.5, (memLv * 0.06 + (s.totalGenerations || s.generation) * 0.025) * 0.5);
  const firstGenScale = s.generation === 1 && (s.ascensionCount || 0) === 0 ? 0.65 : 1.0;
  const baseUnit = (0.095 + additivePool * 0.12) * firstGenScale * globalMult * specMult * masteryBonus * reps;

  const curVal = s.stats[drill.primaryStat] || 0;
  const capVal = s.statCaps[drill.primaryStat] || 10;
  const isCapped = curVal >= capVal;
  const hasBreak = !isBtBanned && Boolean(s.breakthroughs?.limit_break_manual);
  const ch4OverMult = s.completedChallenges?.includes('ch_half_cap') ? 2.5 : 1.0;
  const diminishing = overCapDiminishing(curVal, capVal);
  const overRatio = overCapRatio(hasBreak, ch4OverMult) * diminishing;
  const estDelta = isCapped ? baseUnit * overRatio : baseUnit;

  return { effStam, effMent, estDelta, mLv, reps };
};

// --- AI練習メニュー自動切替用：最適リスト算出 ---
const computeOptimalAutoList = (s) => {
  const isPureBody = s.activeChallenge === 'ch_pure_body';
  const available = DRILLS_DEF.filter(
    (d) => s.unlocks?.[d.id] && (!isPureBody || (d.id !== 'tactics_video' && d.id !== 'mental_image'))
  );
  const uncapped = available.filter((d) => {
    if (d.secondaryStat) {
      return (
        (s.stats[d.primaryStat] || 0) < (s.statCaps[d.primaryStat] || 10) ||
        (s.stats[d.secondaryStat] || 0) < (s.statCaps[d.secondaryStat] || 10)
      );
    }
    return (s.stats[d.primaryStat] || 0) < (s.statCaps[d.primaryStat] || 10);
  });
  const pool = uncapped.length > 0 ? uncapped : available;
  return pool.slice(0, s.maxAutoSlots || 5).map((d) => d.id);
};

// --- サブコンポーネント ---
// 宿敵に5勝したときの報酬。
//
// 本人の指摘（2026-11-26）:
//   「宿敵の好感ユニフォームの入手に手動クリックでのライバル勝利が5回必要のようだが、
//     こういうのは自動クリックでも達成されるようにしろ」
//
// 以前は手動の challengeRival にしか書いていなかったので、
// 敏腕秘書に任せていると永遠に取れなかった。
// s を直接書き換える。呼び出し側は手動・自動のどちらでもよい。
const applyRivalMilestone = (s, tierObj, wins, onToast) => {
  if (!tierObj || wins < 5) return;

  if (!s.rivalPerksUnlocked?.includes(tierObj.perkId)) {
    s.rivalPerksUnlocked = [...(s.rivalPerksUnlocked || []), tierObj.perkId];
    const caps = { ...(s.rivalPerkCaps || { tec: 0, phy: 0, iq: 0, sht: 0 }) };
    if (tierObj.tier === 0) caps.iq += 4;
    else if (tierObj.tier === 1) caps.phy += 7;
    else if (tierObj.tier === 2) {
      caps.tec += 10;
      caps.phy += 10;
      caps.iq += 10;
      caps.sht += 10;
    } else {
      caps.tec += 18;
      caps.phy += 18;
      caps.iq += 18;
      caps.sht += 18;
    }
    s.rivalPerkCaps = caps;
    s.rivalCoopUnlocked = true;
    s.storyFlavor = `🤝【宿敵との和解＆共闘タッグ結成】${tierObj.name}：${tierObj.coopQuote}`;
    if (onToast) onToast(`🤝 ${tierObj.name}と共闘タッグ結成！`, tierObj.perkLabel, 'amber');
  }

  if (!s.unlockedCharms?.includes('charm_rival')) {
    s.unlockedCharms = [...(s.unlockedCharms || []), 'charm_rival'];
    if (onToast) onToast('🎽 絆のお守り獲得', '「宿敵の交換ユニフォーム」を獲得した！', 'amber');
  }
};

const MiniBar = ({ label, current, max, colorClass, rateText }) => {
  const pct = Math.min(100, Math.max(0, (current / Math.max(1, max)) * 100));
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[9px] leading-none mb-0.5 tabular-nums">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-200">
          {formatNum(current)}/{formatNum(max)}
          {rateText && <span className="text-emerald-400 ml-0.5">{rateText}</span>}
        </span>
      </div>
      <div className="w-full h-1 bg-slate-900 border border-slate-800 overflow-hidden">
        <div className={`h-full transition-all duration-150 ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// 1ティック進めるための state の複製。
// advanceOneMonth は渡された state を直接書き換えるので、
// 書き換わるネストをここで浅くコピーしておく必要がある。
// （根本的には docs/REFACTOR_PLAN.md Phase 4 でミューテーションを潰す）
const cloneStateForTick = (prev) => ({
          ...prev,
          stats: { ...prev.stats },
          statCaps: { ...prev.statCaps },
          relations: { ...prev.relations },
          life: { ...prev.life },
          rival: { ...prev.rival },
          mastery: { ...prev.mastery },
          upgrades: { ...prev.upgrades },
          unlocks: { ...prev.unlocks },
          genomes: { ...prev.genomes },
          breakthroughs: { ...prev.breakthroughs },
          hobbies: { ...prev.hobbies },
          brandProjects: { ...prev.brandProjects },
          endlessInvest: { ...prev.endlessInvest },
          clubMates: { ...prev.clubMates },
          clubFacilities: { ...prev.clubFacilities },
          protege: { ...prev.protege },
          protegeBonds: { ...prev.protegeBonds },
          partnerRecords: { ...prev.partnerRecords },
          tacticalMastery: { ...prev.tacticalMastery },
          euroMastery: { ...prev.euroMastery },
          careerDrillCounts: { ...prev.careerDrillCounts },
          careerPosMatches: { ...prev.careerPosMatches },
          careerBodyWins: { ...prev.careerBodyWins },
          careerPathWins: { ...prev.careerPathWins },
          careerPathMatches: { ...prev.careerPathMatches }
});

export default function App() {
  // --- 初期ステート生成 ---
  const createInitialState = useCallback(
    (
      generation = 1,
      legacyPoints = 0,
      legacyUpgrades = {},
      hallOfFame = [],
      achievements = [],
      profile = { playerName: '蒼井 翼', bodyType: 'balanced', position: 'CF' },
      genomes = {},
      fusedGenomes = [],
      archivedGenomes = [],
      secretGenomes = [],
      careerCounters = {
        totalCareerGoals: 0,
        totalCareerAssists: 0,
        careerWins: 0,
        careerTotalMatches: 0,
        careerDefMatches: 0,
        careerVeteranMonths: 0,
        careerDrillCounts: {},
        careerPosMatches: {},
        careerBodyWins: {},
        careerPathWins: {},
        careerPathMatches: {},
        careerUnderdogCups: 0,
        careerUniPoints: 0,
        careerTotalAffection: 0,
        careerFamilyEvents: 0,
        careerHobbyTotalLv: 0,
        careerCoachLessons: 0,
        careerTeamDinners: 0,
        careerRivalWins: 0,
        careerMediaCount: 0,
        careerEuroCcWins: 0,
        careerWorldWins: 0,
        careerProtegeExp: 0,
        careerSonWins: 0,
        careerDaughterWins: 0
      },
      carriedUpgrades = null,
      ascensionData = {
        ascensionCount: 0,
        ascensionPoints: 0,
        ascensionUpgrades: {},
        totalGenerations: 1,
        completedTrials: []
      },
      unlockedCharms = [],
      equippedCharms = [],
      persistentPerks = {
        posEventsDone: [],
        posEventCaps: { tec: 0, phy: 0, iq: 0, sht: 0 },
        rivalPerksUnlocked: [],
        rivalPerkCaps: { tec: 0, phy: 0, iq: 0, sht: 0 },
        localClubLv: 1,
        clubMates: { mate_gk: 1, mate_cb: 1, mate_cmf: 1, mate_wg: 1, mate_fw: 1 },
        clubFacilities: { fac_turf: 0, fac_cafeteria: 0, fac_scout: 0, fac_stadium: 0 },
        rivalCoopUnlocked: false,
        unlockedTraits: [],
        equippedTraits: [],
        intlCupsWon: 0,
        protegeData: { archetypeId: null, bondLv: 1 },
        protegeBonds: {},
        partnerRecords: {},
        tacticalMastery: { balanced: 0, gegenpress: 0, tikitaka: 0, catenaccio: 0 },
        euroMastery: { england: 0, spain: 0, italy: 0, france: 0 },
        retainedHobbies: {},
        prophecyLv: 0
      },
      inheritedBreakthroughs = {},
      inheritedHabitMastery = {},
      unlockedEndings = [],
      completedChallenges = [],
      activeChallenge = null,
      tacticalStyle = 'balanced',
      qolToggles = { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false, pauseOnRebirth: true },
      preChallengeSnapshot = null
    ) => {
      const bodyLv = legacyUpgrades.iron_body || 0;
      const mindLv = legacyUpgrades.sharp_mind || 0;
      const connLv = legacyUpgrades.club_connection || 0;
      // 初期資金は加算（コネ）と乗算（相場の記憶）の二段構え。
      // 本人の要望（2026-11-23）:
      //   「競馬の記憶以外にももっと初期資金が豊富になる手段用意したい」
      const marketLv = legacyUpgrades.market_memory || 0;
      const startMoneyMult = Math.pow(1.8, marketLv);
      const memLv = legacyUpgrades.tactical_memory || 0;
      const growthMemLv = legacyUpgrades.growth_memory || 0;

      const bType = BODY_TYPES[profile.bodyType] ? profile.bodyType : 'balanced';
      const targetH = BODY_TYPES[bType].height;

      const ascCount = ascensionData.ascensionCount || 0;
      const ascPts = ascensionData.ascensionPoints || 0;
      const ascUpgrades = ascensionData.ascensionUpgrades || {};
      const totalGens = ascensionData.totalGenerations || generation;
      const completedTrials = ascensionData.completedTrials || [];

      const posEventCaps = persistentPerks.posEventCaps || { tec: 0, phy: 0, iq: 0, sht: 0 };
      const rivalPerkCaps = persistentPerks.rivalPerkCaps || { tec: 0, phy: 0, iq: 0, sht: 0 };
      // 蒼空FCへの投資（クラブのレベル・同僚・施設）はタイムリープでリセットする。
      // 時間が5歳の春まで巻き戻るので、建てた施設も育てた同僚も存在しない。
      // docs/GAME_DESIGN.md §14-2。以前は persistentPerks から引き継いでいた。
      const localClubLv = 1;
      const clubMates = { mate_gk: 1, mate_cb: 1, mate_cmf: 1, mate_wg: 1, mate_fw: 1 };
      const clubFacilities = {
        fac_turf: 0,
        fac_cafeteria: 0,
        fac_scout: 0,
        fac_stadium: 0
      };
      const rivalCoopUnlocked = Boolean(persistentPerks.rivalCoopUnlocked);
      const unlockedTraits = [...(persistentPerks.unlockedTraits || [])];
      const equippedTraits = [...(persistentPerks.equippedTraits || [])];
      const intlCupsWon = persistentPerks.intlCupsWon || 0;
      const protegeBonds = { ...(persistentPerks.protegeBonds || {}) };
      const partnerRecords = { ...(persistentPerks.partnerRecords || {}) };
      const tacticalMastery = {
        balanced: 0,
        gegenpress: 0,
        tikitaka: 0,
        catenaccio: 0,
        ...(persistentPerks.tacticalMastery || {})
      };
      const euroMastery = {
        england: 0,
        spain: 0,
        italy: 0,
        france: 0,
        ...(persistentPerks.euroMastery || {})
      };

      const isGearBanned = activeChallenge === 'ch_no_gear' || activeChallenge === 'ch_ascetic_god';
      const isBtBanned = activeChallenge === 'ch_no_memory' || activeChallenge === 'ch_ascetic_god';
      const initUpgrades = isGearBanned ? {} : carriedUpgrades ? { ...carriedUpgrades } : {};

      const retainedHobbies = { ...(persistentPerks.retainedHobbies || {}) };
      const prophecyLv = persistentPerks.prophecyLv || 0;

      // タイムリープすると弟子との関係もゼロに戻る。
      // 向こうはこちらを覚えていないし、まだ出会ってもいない（docs/GAME_DESIGN.md §2）。
      // protegeBonds は図鑑（各アーキタイプの最高到達Lv）の記録専用。
      // この人生で誰を育てるかは、この人生であらためて選ぶ。
      const protege = { archetypeId: null, bondLv: 1 };

      const isTwilightChallenge = activeChallenge === 'ch_twilight_32';
      const startAge = isTwilightChallenge ? 32 : 5;
      const startCat = isTwilightChallenge ? 7 : 0;

      const initStamina = 18 + bodyLv * 8 + (initUpgrades.agility_gear || 0) * 4 + (retainedHobbies.cooking || 0) * 8;
      const initMental = 15 + mindLv * 8 + (retainedHobbies.golf || 0) * 6;
      const isNextGen = totalGens > 1 || generation > 1 || ascCount > 0;
      // この周回で新しく解放された機能。開始時にモーダルで説明を出す
      const freshUnlocks = newlyUnlocked(totalGens - 1, totalGens, ascCount);
      const persistBt = isBtBanned ? {} : { ...(inheritedBreakthroughs || {}) };
      const caps = computeIndividualStatCaps(
        generation,
        legacyUpgrades,
        achievements,
        profile.position,
        bType,
        genomes,
        fusedGenomes,
        secretGenomes,
        ascUpgrades,
        {},
        posEventCaps,
        rivalPerkCaps,
        completedTrials,
        ascCount,
        unlockedEndings,
        completedChallenges,
        activeChallenge,
        protegeBonds,
        startAge
      );

      const cosmicEngineStart = (ascUpgrades.cosmic_genesis_engine || 0) * 25;
      const ch7StartBonus = completedChallenges.includes('ch_no_memory') ? 25 : 0;
      const bodyStartBase = isTwilightChallenge
        ? 16.0
        : generation === 1 && ascCount === 0
          ? 0.35
          : Math.min(2.2, 0.55 + (generation - 1) * 0.08 + ascCount * 0.25);
      const iqStartBase =
        bodyStartBase +
        (ascCount >= 4 ? 14.0 : ascCount >= 3 ? 6.0 : ascCount >= 2 ? 3.0 : ascCount >= 1 ? 1.2 : 0) +
        cosmicEngineStart +
        ch7StartBonus;

      const achMoney = achievements.includes('jy_pass') ? 3500 : 0;
      const posObj = POSITIONS[profile.position] || POSITIONS.CF;

      const schedLv = initUpgrades.ai_schedule || 0;
      const initialMaxAuto = persistBt.smart_auto_all ? 5 : Math.min(5, 1 + memLv + Math.min(4, schedLv));
      const initialAutoActions = isNextGen || persistBt.smart_auto_all ? ALL_DRILL_IDS.slice(0, initialMaxAuto) : [];

      // 鉄人の肉体遺伝子は継承結晶で買う「現役寿命」そのもの。
      // 以前はここに入っておらず、購入時に maxRetireAge へ加算するだけだったため、
      // 転生して createInitialState が走ると効果が消えていた。
      const ironBodyLv = legacyUpgrades.iron_body || 0;
      const extraLifeBonus =
        ironBodyLv * 2.0 +
        (secretGenomes.includes('secret_veteran_iron') ? 2 : 0) +
        (genomes.king_eternal_dna || 0) * 0.6 +
        (fusedGenomes.includes('fused_eternal_king') ? 2 : 0) +
        (completedChallenges.includes('ch_twilight_32') ? 3 : 0);

      const habitRetainRatio =
        activeChallenge === 'ch_no_memory' ? 0 : isNextGen ? Math.min(0.6, 0.12 + growthMemLv * 0.03) : 0;
      const retainedMastery = {
        tech_drill: Math.floor((inheritedHabitMastery?.tech_drill || 0) * habitRetainRatio),
        phy_drill: Math.floor((inheritedHabitMastery?.phy_drill || 0) * habitRetainRatio),
        tactics_video: Math.floor((inheritedHabitMastery?.tactics_video || 0) * habitRetainRatio),
        shoot_drill: Math.floor((inheritedHabitMastery?.shoot_drill || 0) * habitRetainRatio),
        mental_image: Math.floor((inheritedHabitMastery?.mental_image || 0) * habitRetainRatio)
      };

      const maxC = computeMaxCharmSlots(legacyUpgrades, ascUpgrades, genomes);
      const maxT = computeMaxTraitSlots(ascCount, ascUpgrades, legacyUpgrades, persistBt);
      const safeEquippedCharms = [...unlockedCharms].filter((id) => equippedCharms.includes(id)).slice(0, maxC);
      const safeEquippedTraits = [...unlockedTraits].filter((id) => equippedTraits.includes(id)).slice(0, maxT);

      const chObj = activeChallenge ? CHALLENGES_DEF.find((c) => c.id === activeChallenge) : null;
      const introMsg = chObj
        ? `【縛りチャレンジ開始・${startAge}歳4月】${chObj.code}「${chObj.name}」に挑戦！（終了後は元の資産に完全復元）`
        : generation === 1 && ascCount === 0
          ? `【第1周目・5歳4月】無名の補欠候補「${profile.playerName}」の人生が始まった！まずは上の『コーン・ドリブル』で基礎を鍛えよう！`
          : `【タイムリープ発動・5歳4月】頭脳と知識は大人だが、肉体はただの5歳児！成長期に合わせて再び世界の高みへ駆け上がろう！`;

      return {
        pendingUnlocks: freshUnlocks.length > 0 ? freshUnlocks.map((u) => u.id) : null,
        homeClubName: persistentPerks.homeClubName || '蒼空FC',
        generation,
        totalGenerations: totalGens,
        ascensionCount: ascCount,
        ascensionPoints: ascPts,
        ascensionUpgrades: { ...ascUpgrades },
        completedTrials: [...completedTrials],
        unlockedEndings: [...unlockedEndings],
        completedChallenges: [...completedChallenges],
        activeChallenge: activeChallenge || null,
        preChallengeSnapshot: preChallengeSnapshot || null,
        tacticalStyle: TACTICAL_STYLES[tacticalStyle] ? tacticalStyle : 'balanced',
        tacticalMastery,
        euroMastery,

        // 周回ごとに新しい乱数の種を引く。
        // シミュレーションで固定したいときは生成後に上書きする。
        rngState: createSeed(),

        legacyPoints,
        legacyUpgrades: { ...legacyUpgrades },
        qolToggles: {
          autoGearBuy: qolToggles.autoGearBuy !== undefined ? Boolean(qolToggles.autoGearBuy) : true,
          autoSocialRun: qolToggles.autoSocialRun !== undefined ? Boolean(qolToggles.autoSocialRun) : true,
          autoCareerPath: Boolean(qolToggles.autoCareerPath),
          // 転生した直後に時間を止めるか。止めれば落ち着いて方針を決められる
          pauseOnRebirth: qolToggles.pauseOnRebirth !== undefined ? Boolean(qolToggles.pauseOnRebirth) : true,
          hideCompleted: Boolean(qolToggles.hideCompleted)
        },
        hallOfFame,
        achievements,
        genomes: { ...genomes },
        fusedGenomes: [...fusedGenomes],
        archivedGenomes: [...archivedGenomes],
        secretGenomes: [...secretGenomes],
        breakthroughs: persistBt,
        hobbies: retainedHobbies,
        prophecyLv,
        brandProjects: { school_tour: 0, sig_brand: 0 },
        endlessInvest: { endless_lab: 0, endless_ai: 0, endless_fund: 0 },

        zoneCharge: 0,
        zoneFeverMonths: 0,

        ...careerCounters,

        posEventsDone: [...(persistentPerks.posEventsDone || [])],
        posEventCaps,
        rivalPerksUnlocked: [...(persistentPerks.rivalPerksUnlocked || [])],
        rivalPerkCaps,
        localClubLv,
        clubMates,
        clubFacilities,
        rivalCoopUnlocked,
        unlockedTraits,
        equippedTraits: safeEquippedTraits,
        maxTraitSlots: maxT,
        intlCupsWon,
        protege,
        protegeBonds,
        partnerRecords,

        unlockedCharms: [...unlockedCharms],
        equippedCharms: safeEquippedCharms,
        maxCharmSlots: maxC,

        playerName: profile.playerName || '蒼井 翼',
        bodyType: bType,
        targetHeight: targetH,
        position: posObj.id,
        careerPath: isTwilightChallenge ? 'jfl_path' : 'school_kids',
        careerPathLabel: isTwilightChallenge ? 'ベテラン再挑戦' : 'キッズスクール生',
        clubName: isTwilightChallenge ? '蒼空FC社会人' : '蒼空キッズSC',
        euroCountry: 'england',

        age: startAge,
        month: 4,
        matchCounter: 0,
        // 基礎は短く置く。現役年数は継承結晶で伸ばすもの、という設計。
        maxRetireAge: Math.round(28 + bodyLv * 0.5 + extraLifeBonus),
        peakRatingReached: 0,
        isRetired: false,
        categoryId: startCat,
        // この人生で到達した最高カテゴリ。上位転生の条件判定に使う
        peakCategoryId: startCat,
        triggeredEvents: [],

        level: 1,
        exp: 0,
        maxExp: 26,
        stamina: initStamina,
        maxStamina: initStamina,
        mental: initMental,
        maxMental: initMental,
        money: Math.floor((2000 + connLv * 6000) * startMoneyMult) + achMoney,
        tactics: 5 + connLv * 20 + marketLv * 15,
        fans: 0,

        stats: {
          tec: Number((bodyStartBase * posObj.capRatio.tec).toFixed(2)),
          phy: Number((bodyStartBase * posObj.capRatio.phy).toFixed(2)),
          iq: Number((iqStartBase * posObj.capRatio.iq).toFixed(2)),
          sht: Number((bodyStartBase * posObj.capRatio.sht).toFixed(2))
        },
        statCaps: caps,

        relations: {
          familyLabel: '両親の温かい応援',
          coachTrust: 1,
          teamChem: 1
        },
        life: {
          status: '独身・サッカー一筋',
          partnerType: null,
          affection: 0,
          married: false,
          hasChild: false,
          childGender: null,
          childTalent: null,
          childActive: false,
          childRating: 0
        },
        rival: {
          tierIdx: 0,
          rating: 18,
          winsAgainst: 0
        },

        storyFlavor: introMsg,

        matchesPlayed: 0,
        wins: 0,
        winStreak: 0,
        goals: 0,
        assists: 0,
        momCount: 0,
        cupsWon: 0,
        lastMatchReport: null,
        lastHighlightLines: null,

        mastery: retainedMastery,
        upgrades: initUpgrades,

        unlocks: {
          // 基礎の技術練習は最初から使える。
          // ここに tech_drill が無かったため、JSX のフィルタ
          // （DRILLS_DEF.filter(d => gameState.unlocks[d.id])）で
          // 永久に表示されず、AUTO の候補からも外れていた。
          // チュートリアルは「上の『コーン・ドリブル』で基礎を鍛えよう」と
          // 案内しているのに、そのカードが存在しない状態だった。
          tech_drill: true,
          phy_drill: isNextGen || isTwilightChallenge,
          tactics_video: isNextGen || isTwilightChallenge,
          shoot_drill: isNextGen || isTwilightChallenge,
          mental_image: isNextGen || isTwilightChallenge,
          upgradesTab: isNextGen || isTwilightChallenge,
          autoFeature: isNextGen || isTwilightChallenge || persistBt.smart_auto_all,
          reincarnateTab: isNextGen || isTwilightChallenge
        },
        autoActions: initialAutoActions,
        maxAutoSlots: initialMaxAuto,

        log: [
          {
            id: Date.now(),
            stamp: `${startAge}歳4月`,
            text: introMsg,
            type: 'story'
          }
        ]
      };
    },
    []
  );

  // --- セーブデータ復元＆アップデート時チュートリアル判定 ---
  const [initialBootInfo] = useState(() => {
    try {
      const v012Raw = localStorage.getItem(SAVE_KEY);
      if (v012Raw) {
        const parsed = JSON.parse(v012Raw);
        if (parsed && parsed.stats && typeof parsed.stats.tec === 'number') {
          const seenVer = parsed.tutorialSeenVersion || 0;
          return {
            loaded: parsed,
            isNewUser: false,
            showUpdateTutorial: seenVer !== CURRENT_TUTORIAL_VERSION
          };
        }
      }
      for (const k of LEGACY_SAVE_KEYS) {
        const legacyRaw = localStorage.getItem(k);
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          if (parsed && parsed.stats && typeof parsed.stats.tec === 'number') {
            return {
              loaded: parsed,
              isNewUser: false,
              showUpdateTutorial: true
            };
          }
        }
      }
    } catch (e) {
      // ignore
    }
    return { loaded: null, isNewUser: true, showUpdateTutorial: false };
  });

  const [gameState, setGameState] = useState(() => {
    const parsed = initialBootInfo.loaded;
    if (parsed) {
      const base = createInitialState(
        parsed.generation || 1,
        parsed.legacyPoints || 0,
        parsed.legacyUpgrades || {},
        parsed.hallOfFame || [],
        parsed.achievements || [],
        {
          playerName: parsed.playerName || '蒼井 翼',
          bodyType: parsed.bodyType || 'balanced',
          position: parsed.position || 'CF'
        },
        parsed.genomes || {},
        parsed.fusedGenomes || [],
        parsed.archivedGenomes || [],
        parsed.secretGenomes || [],
        {
          totalCareerGoals: parsed.totalCareerGoals || 0,
          totalCareerAssists: parsed.totalCareerAssists || 0,
          careerWins: parsed.careerWins || 0,
          careerTotalMatches: parsed.careerTotalMatches || 0,
          careerDefMatches: parsed.careerDefMatches || 0,
          careerVeteranMonths: parsed.careerVeteranMonths || 0,
          careerDrillCounts: parsed.careerDrillCounts || {},
          careerPosMatches: parsed.careerPosMatches || {},
          careerBodyWins: parsed.careerBodyWins || {},
          careerPathWins: parsed.careerPathWins || {},
          careerPathMatches: parsed.careerPathMatches || {},
          careerUnderdogCups: parsed.careerUnderdogCups || 0,
          careerUniPoints: parsed.careerUniPoints || 0,
          careerTotalAffection: parsed.careerTotalAffection || 0,
          careerFamilyEvents: parsed.careerFamilyEvents || 0,
          careerHobbyTotalLv: parsed.careerHobbyTotalLv || 0,
          careerCoachLessons: parsed.careerCoachLessons || 0,
          careerTeamDinners: parsed.careerTeamDinners || 0,
          careerRivalWins: parsed.careerRivalWins || 0,
          careerMediaCount: parsed.careerMediaCount || 0,
          careerEuroCcWins: parsed.careerEuroCcWins || 0,
          careerWorldWins: parsed.careerWorldWins || 0,
          careerProtegeExp: parsed.careerProtegeExp || 0,
          careerSonWins: parsed.careerSonWins || 0,
          careerDaughterWins: parsed.careerDaughterWins || 0
        },
        parsed.upgrades || null,
        {
          ascensionCount: parsed.ascensionCount || 0,
          ascensionPoints: parsed.ascensionPoints || 0,
          ascensionUpgrades: parsed.ascensionUpgrades || {},
          totalGenerations: parsed.totalGenerations || parsed.generation || 1,
          completedTrials: parsed.completedTrials || []
        },
        parsed.unlockedCharms || [],
        parsed.equippedCharms || [],
        {
          posEventsDone: parsed.posEventsDone || [],
          posEventCaps: parsed.posEventCaps || { tec: 0, phy: 0, iq: 0, sht: 0 },
          rivalPerksUnlocked: parsed.rivalPerksUnlocked || [],
          rivalPerkCaps: parsed.rivalPerkCaps || { tec: 0, phy: 0, iq: 0, sht: 0 },
          localClubLv: parsed.localClubLv || 1,
          clubMates: parsed.clubMates || { mate_gk: 1, mate_cb: 1, mate_cmf: 1, mate_wg: 1, mate_fw: 1 },
          clubFacilities: parsed.clubFacilities || { fac_turf: 0, fac_cafeteria: 0, fac_scout: 0, fac_stadium: 0 },
          rivalCoopUnlocked: Boolean(parsed.rivalCoopUnlocked),
          unlockedTraits: parsed.unlockedTraits || [],
          equippedTraits: parsed.equippedTraits || [],
          intlCupsWon: parsed.intlCupsWon || 0,
          protegeData: parsed.protege || { archetypeId: null, bondLv: 1 },
          protegeBonds: parsed.protegeBonds || {},
          partnerRecords: parsed.partnerRecords || {},
          tacticalMastery: parsed.tacticalMastery || { balanced: 0, gegenpress: 0, tikitaka: 0, catenaccio: 0 },
          euroMastery: parsed.euroMastery || { england: 0, spain: 0, italy: 0, france: 0 },
          retainedHobbies: parsed.hobbies || {},
          prophecyLv: parsed.prophecyLv || 0
        },
        parsed.breakthroughs || {},
        parsed.mastery || {},
        parsed.unlockedEndings || [],
        parsed.completedChallenges || [],
        parsed.activeChallenge || null,
        parsed.tacticalStyle || 'balanced',
        parsed.qolToggles || { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false },
        parsed.preChallengeSnapshot || null
      );

      const autoArchived = [...new Set([...(parsed.archivedGenomes || [])])];
      for (const def of BASE_GENOME_DEF) {
        if (def.isPathGenome && (parsed.genomes?.[def.id] || 0) >= 5 && !autoArchived.includes(def.id)) {
          autoArchived.push(def.id);
        }
      }

      const merged = {
        ...base,
        ...parsed,
        archivedGenomes: autoArchived,
        tutorialSeenVersion: parsed.tutorialSeenVersion || 0,
        clubName: parsed.clubName || CATEGORIES[parsed.categoryId || 0]?.clubDefault || '蒼空FC',
        qolToggles: {
          autoGearBuy: parsed.qolToggles?.autoGearBuy !== undefined ? Boolean(parsed.qolToggles.autoGearBuy) : true,
          autoSocialRun: parsed.qolToggles?.autoSocialRun !== undefined ? Boolean(parsed.qolToggles.autoSocialRun) : true,
          autoCareerPath: Boolean(parsed.qolToggles?.autoCareerPath),
          hideCompleted: Boolean(parsed.qolToggles?.hideCompleted)
        },
        life: {
          ...base.life,
          ...(parsed.life || {})
        },
        stats: { ...base.stats, ...parsed.stats },
        statCaps: computeIndividualStatCaps(
          parsed.generation || 1,
          parsed.legacyUpgrades || {},
          parsed.achievements || [],
          parsed.position || 'CF',
          parsed.bodyType || 'balanced',
          parsed.genomes || {},
          parsed.fusedGenomes || [],
          parsed.secretGenomes || [],
          parsed.ascensionUpgrades || {},
          parsed.endlessInvest || {},
          parsed.posEventCaps || { tec: 0, phy: 0, iq: 0, sht: 0 },
          parsed.rivalPerkCaps || { tec: 0, phy: 0, iq: 0, sht: 0 },
          parsed.completedTrials || [],
          parsed.ascensionCount || 0,
          parsed.unlockedEndings || [],
          parsed.completedChallenges || [],
          parsed.activeChallenge || null,
          parsed.protegeBonds || {},
          parsed.age || 5
        )
      };
      clampEquippedLists(merged);
      return merged;
    }
    return {
      ...createInitialState(),
      tutorialSeenVersion: 0
    };
  });

  // UI状態
  const [gameSpeed, setGameSpeed] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [bottomTab, setBottomTab] = useState('matches');
  const [investSubTab, setInvestSubTab] = useState('gear');
  const [genomeSubTab, setGenomeSubTab] = useState('active');
  const [leapSubTab, setLeapSubTab] = useState('crystal');
  const [buyAmount, setBuyAmount] = useState(1);
  const [showLogDrawer, setShowLogDrawer] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [tutorialModalOpen, setTutorialModalOpen] = useState(() => initialBootInfo.showUpdateTutorial);
  const [saveTransferText, setSaveTransferText] = useState('');
  const [confirmHardReset, setConfirmHardReset] = useState(false);
  const [inspectorText, setInspectorText] = useState(
    '第1周目は無名の補欠候補からのスタート！まずは上の『コーン・ドリブル（技術）』で基礎を積み上げよう。'
  );
  const [toasts, setToasts] = useState([]);
  const [careerChoiceModal, setCareerChoiceModal] = useState(null);
  const [truckEventModal, setTruckEventModal] = useState(null);
  const [confirmReincarnate, setConfirmReincarnate] = useState(false);
  const [confirmAscend, setConfirmAscend] = useState(false);
  const [creatorModal, setCreatorModal] = useState(() => ({
    open: initialBootInfo.isNewUser,
    mode: 'new',
    ascensionAwarded: 0,
    playerName: '蒼井 翼',
    bodyType: 'balanced',
    position: 'CF',
    selectedChallenge: null
  }));

  const modalOpenedAtRef = useRef(0);

  // 未解放の速度が選択されていたら1xに戻す
  useEffect(() => {
    if (gameSpeed === 2 && (gameState.legacyUpgrades?.speed_2x || 0) < 1) setGameSpeed(1);
    if (gameSpeed === 4 && (gameState.legacyUpgrades?.speed_4x || 0) < 1) setGameSpeed(1);
    if (gameSpeed === 8 && (gameState.ascensionUpgrades?.speed_8x || 0) < 1) setGameSpeed(1);
  }, [gameSpeed, gameState.legacyUpgrades, gameState.ascensionUpgrades]);

  // ゲームループが積んだモーダル要求を取り出して開く
  useEffect(() => {
    const pending = gameState.pendingModal;
    if (!pending) return;
    modalOpenedAtRef.current = Date.now();
    if (pending.type === 'career') {
      setCareerChoiceModal(pending.modal);
    } else if (pending.type === 'truck') {
      setTruckEventModal(pending.modal);
    }
  }, [gameState.pendingModal]);

  // オートセーブ
  // pendingModal も保存する。進路選択モーダルが開いたままタブを閉じても、
  // 次回ロード時に上の useEffect が拾って開き直す。保存しないと
  // triggeredEvents だけが立って進路選択が永久に失われる。
  useEffect(() => {
    try {
      // 最終プレイ時刻を一緒に残す。次に開いたときの経過分を進めるのに使う
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...gameState, lastPlayedAt: Date.now() }));
    } catch (e) {
      // ignore
    }
  }, [gameState]);

  // --- オフライン進行（タブを閉じていた間も時間を進める） ---
  //
  // 放置ゲームなので、開いていない間も選手は育っているべき。
  // 最終プレイ時刻からの経過を1ティック=1ヶ月に換算してまとめて進める。
  // 進路選択や引退に当たったらそこで止める（勝手に選ばせない）。
  const offlineDoneRef = useRef(false);
  useEffect(() => {
    if (offlineDoneRef.current) return;
    offlineDoneRef.current = true;

    const last = gameState.lastPlayedAt;
    if (!last || typeof last !== 'number') return;

    const elapsedMs = Date.now() - last;
    if (elapsedMs < 60000) return; // 1分未満は無視（リロードなど）

    const tickMs = Math.max(125, Math.floor(1000 / gameSpeed));
    const ticks = Math.min(MAX_OFFLINE_MONTHS, Math.floor(elapsedMs / tickMs));
    if (ticks <= 0) return;

    setGameState((prev) => {
      if (prev.isRetired || prev.pendingModal) return prev;
      const cur = cloneStateForTick(prev);
      let advanced = 0;
      for (let i = 0; i < ticks; i++) {
        if (cur.isRetired) break;
        const requested = advanceOneMonth(cur, { suppressToast: true });
        advanced += 1;
        if (requested) {
          cur.pendingModal = requested;
          break;
        }
      }
      cur.offlineReport = { months: advanced, elapsedMs, capped: ticks >= MAX_OFFLINE_MONTHS };
      return cur;
    });
    // マウント時に一度だけ走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // オフライン進行の結果を知らせる
  useEffect(() => {
    const rep = gameState.offlineReport;
    if (!rep || rep.months <= 0) return;
    const hours = Math.floor(rep.elapsedMs / 3600000);
    const mins = Math.floor((rep.elapsedMs % 3600000) / 60000);
    const away = hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
    pushToast(
      '⏳ 離れている間も時間は進んだ',
      `${away}ぶん（ゲーム内 ${rep.months}ヶ月）進行${rep.capped ? '（上限まで）' : ''}`,
      'sky'
    );
    setGameState((prev) => ({ ...prev, offlineReport: null }));
    // pushToast はこの位置より後で定義されるため依存配列に置けない（TDZ になる）。
    // useCallback で安定しているので、コールバック内から参照するだけで足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.offlineReport]);

  const closeTutorialModal = () => {
    setTutorialModalOpen(false);
    setGameState((prev) => ({
      ...prev,
      tutorialSeenVersion: CURRENT_TUTORIAL_VERSION
    }));
  };

  const pushToast = useCallback((title, desc, tone = 'sky') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [{ id, title, desc, tone }, ...prev].slice(0, 3));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const addLogMsg = (s, text, type = 'info') => {
    s.log = [
      {
        id: Date.now() + Math.random(),
        stamp: `${s.age}歳${s.month}月`,
        text,
        type
      },
      ...(s.log || [])
    ].slice(0, 60);
  };

  // --- ZONEゲージ加算＆自動発動処理 ---
  const addZoneCharge = useCallback(
    (s, baseGain, suppressToast = false) => {
      if ((s.zoneFeverMonths || 0) > 0) return;
      const tStyle = TACTICAL_STYLES[s.tacticalStyle] || TACTICAL_STYLES.balanced;
      const syns = getActiveSynergies(s);
      const fanRank = getFanRankInfo(s.fans || 0);
      const urRank = getUnrivaledRank(s.age, getTotalRating(s), s.totalGenerations || s.generation);
      const edWorldMult = s.unlockedEndings?.includes('ed_world_myth') ? 1.2 : 1.0;
      const synMult =
        (syns.some((x) => x.id === 'syn_agile_trickster') ? 1.25 : 1.0) *
        (syns.some((x) => x.id === 'syn_gegen_beast') ? 1.35 : 1.0);
      const gain = baseGain * tStyle.zoneGainMult * synMult * fanRank.zoneMult * urRank.zoneMult * edWorldMult;
      s.zoneCharge = Math.min(100, Number(((s.zoneCharge || 0) + gain).toFixed(1)));

      if (s.zoneCharge >= 100) {
        s.zoneCharge = 0;
        s.zoneFeverMonths = 6;
        const msg = '🔥【ZONE FEVER 自動突入】極限集中状態に突入！6ヶ月間、全成長×2.2倍・戦力×1.3倍・賞金×1.6倍！';
        s.storyFlavor = msg;
        addLogMsg(s, msg, 'levelup');
        if (!suppressToast) {
          pushToast('🔥 ZONE FEVER 自動突入！', '6ヶ月間、成長速度2.2倍＆試合戦力1.3倍！', 'amber');
        }
      }
    },
    [pushToast]
  );

  // --- 獲得継承結晶の算出（100周目バランスへ調整） ---
  const calculateLegacyGain = useCallback((s) => {
    // 継承結晶は「その人生でどこまで到達したか」の対価にする。
    //
    // 以前は勝利数・ゴール数・年齢に比例していたため、
    //   ・長く現役を続けるほど得（48〜63歳まで引っ張るのが最適解になっていた）
    //   ・一方で中身の薄い周回を高速で回すのも得
    // という、両極だけが得で中間が損な形になっていた（docs/BALANCE_LOG.md ⑩）。
    //
    // 到達度だけで決めれば、30歳以降は伸びないので粘る意味がなくなり、
    // 「伸びなくなったら畳んで次へ」という早期引退のインセンティブが働く。
    const peak = Math.max(s.peakRatingReached || 0, getTotalRating(s));
    const catFactor = Math.pow(s.categoryId + 1, 1.6);
    const peakFactor = Math.pow(peak, 0.55);
    // 試合内容はごく小さい係数で残す（まったく無視すると無得点でも同額になる）
    const matchFactor = Math.pow((s.goals || 0) + (s.assists || 0) * 0.6, 0.45) * 1.2;

    const g = s.genomes || {};
    const syns = getActiveSynergies(s);
    const fanRank = getFanRankInfo(s.fans || 0);
    const worldChampMult = 1 + (g.world_champ_dna || 0) * 0.05;
    const compassMult = s.breakthroughs?.reincarnate_compass ? 1.25 : 1.0;
    const charmMult = s.equippedCharms?.includes('charm_champion') ? 1.15 : 1.0;
    const secretMult = s.secretGenomes?.includes('secret_time_master') ? 1.2 : 1.0;
    const fusedRevMult = s.fusedGenomes?.includes('fused_revolution') ? 1.16 : 1.0;
    const fusedRivalMult = s.fusedGenomes?.includes('fused_eternal_rival') ? 1.12 : 1.0;
    const divineFurnaceMult = 1 + (s.ascensionUpgrades?.divine_crystal_harvest || 0) * 0.28;
    const trialMult = s.completedTrials?.includes('trial_euro_beast') ? 1.15 : 1.0;
    const synHomeMult = syns.some((x) => x.id === 'syn_hometown_hero') ? 1.2 : 1.0;
    const edWorldMult = s.unlockedEndings?.includes('ed_world_myth') ? 1.25 : 1.0;
    const ch3Mult = s.completedChallenges?.includes('ch_lone_wolf') ? 1.4 : 1.0;
    const ch8Mult = s.completedChallenges?.includes('ch_ascetic_god') ? 1.3 : 1.0;
    const intlCupMult = 1 + (s.intlCupsWon || 0) * 0.08;

    const totalMult =
      worldChampMult *
      compassMult *
      charmMult *
      secretMult *
      fusedRevMult *
      fusedRivalMult *
      divineFurnaceMult *
      trialMult *
      synHomeMult *
      edWorldMult *
      ch3Mult *
      ch8Mult *
      intlCupMult *
      fanRank.crystalMult;

    return Math.max(5, Math.floor((catFactor * 2.2 + peakFactor + matchFactor) * totalMult));
  }, []);

  // --- 上位転生時に獲得できる聖杯数の算出 ---
  const calculateAscensionGain = useCallback((s) => {
    const legLvSum = Object.values(s.legacyUpgrades || {}).reduce((a, b) => a + b, 0);
    // 旧式は (legLvSum - 40) / 14 で、解放条件を Lv28 へ下げた後は
    // 主要項が負になり、聖杯が5個しか出ていなかった（docs/BALANCE_LOG.md）。
    const catBonus = Math.max(0, (s.categoryId || 0) - 8) * 4;
    const genBonus = Math.floor((s.totalGenerations || s.generation || 1) / 2);

    // ここまでは「条件を満たした時点」で決まる値なので、
    // 条件を満たした瞬間に転生するのが常に最適になっていた。
    // 本人指摘（2026-11-23）:
    //   「2次転生は鍛えてからしてももらえる聖杯の数は変わらない？
    //     それだと放置してから転生したときのメリットが薄くなるな。
    //     転生条件は今のまま、その転生周回内で鍛えているポイントによって、
    //     少なくてもいいので聖杯もらえる数が増えるといい」
    //
    // その周回で実際に積んだもの（到達ピーク・試合数・得点関与）を足す。
    // 指数を小さくしてあるので、粘れば増えるが、粘りすぎても支配的にはならない。
    const peak = Math.max(s.peakRatingReached || 0, getTotalRating(s));
    const runPeak = Math.pow(Math.max(1, peak), 0.42);
    const runMatches = Math.pow(Math.max(0, s.matchesPlayed || 0), 0.4);
    const runGoals = Math.pow(Math.max(0, (s.goals || 0) + (s.assists || 0) * 0.6), 0.38);
    const runBonus = Math.floor(runPeak + runMatches + runGoals);

    return Math.max(3, Math.floor(legLvSum / 2) + catBonus + genBonus + runBonus);
  }, []);

  // --- ゲノム覚醒・進化・イベント・エンディング・試練チェック ---
  const checkGenomeAwakening = useCallback(
    (s, suppressToast = false) => {
      if (!s.genomes) s.genomes = {};
      if (!s.fusedGenomes) s.fusedGenomes = [];
      if (!s.archivedGenomes) s.archivedGenomes = [];
      if (!s.secretGenomes) s.secretGenomes = [];
      if (!s.posEventsDone) s.posEventsDone = [];
      if (!s.posEventCaps) s.posEventCaps = { tec: 0, phy: 0, iq: 0, sht: 0 };
      if (!s.completedTrials) s.completedTrials = [];
      if (!s.unlockedTraits) s.unlockedTraits = [];
      if (!s.unlockedEndings) s.unlockedEndings = [];

      // 1. ベースゲノム Lv計算
      for (const def of BASE_GENOME_DEF) {
        const val = def.getStatVal(s);
        const targetLv = Math.min(def.maxLv, Math.floor(val / def.step));
        const curLv = s.genomes[def.id] || 0;
        if (targetLv > curLv) {
          s.genomes[def.id] = targetLv;
          addZoneCharge(s, 14, suppressToast);
          if (def.isPathGenome && targetLv >= 5 && !s.archivedGenomes.includes(def.id)) {
            s.archivedGenomes.push(def.id);
          }
          addLogMsg(s, `🧬【遺伝子覚醒】「${def.name}」Lv.${targetLv} に進化！（${def.effectDesc(targetLv)}）`, 'levelup');
          if (!suppressToast) {
            pushToast(`🧬 ${def.name} Lv.${targetLv}`, def.effectDesc(targetLv), 'amber');
          }
        }
      }

      // 2. 融合ゲノム（ベース2種がLv.5以上で自動合体＆親遺伝子はアーカイブ）
      for (const fDef of FUSED_GENOME_DEF) {
        if (s.fusedGenomes.includes(fDef.id)) continue;
        const ready = fDef.parents.every((pid) => (s.genomes[pid] || 0) >= 5);
        if (ready) {
          s.fusedGenomes.push(fDef.id);
          for (const pid of fDef.parents) {
            if (!s.archivedGenomes.includes(pid)) {
              s.archivedGenomes.push(pid);
            }
          }
          addZoneCharge(s, 30, suppressToast);
          addLogMsg(
            s,
            `🌌【ゲノム融合進化】「${fDef.name}」誕生！（${fDef.effectDesc} / 素材遺伝子はアーカイブへ収納）`,
            'levelup'
          );
          if (!suppressToast) {
            pushToast(`🌌 融合進化！${fDef.name}`, fDef.effectDesc, 'purple');
          }
        }
      }

      // 3. 隠しゲノム判定
      const unlockSecret = (secId) => {
        if (s.secretGenomes.includes(secId)) return;
        const def = SECRET_GENOME_DEF.find((d) => d.id === secId);
        if (!def) return;
        s.secretGenomes.push(secId);
        addZoneCharge(s, 25, suppressToast);
        addLogMsg(s, `🔮【隠し遺伝子発現】「${def.name}」が覚醒！（${def.effectDesc}）`, 'levelup');
        if (!suppressToast) {
          pushToast(`🔮 隠し遺伝子発現！${def.name}`, def.effectDesc, 'rose');
        }
      };

      if ((s.secretSmallDefWins || 0) >= 15) unlockSecret('secret_small_giant');
      if ((s.secretGiantAtkContrib || 0) >= 25) unlockSecret('secret_sky_tower');
      if ((s.secretVeteranWins || 0) >= 15) unlockSecret('secret_veteran_iron');
      if ((s.totalGenerations || s.generation || 1) >= 8) unlockSecret('secret_time_master');

      // 4. ポジション別固有マイルストーンイベント
      const pm = s.careerPosMatches || {};
      for (const ev of POS_MILESTONE_EVENTS) {
        if (s.posEventsDone.includes(ev.id)) continue;
        if ((pm[ev.pos] || 0) >= ev.req) {
          s.posEventsDone.push(ev.id);
          s.posEventCaps[ev.capKey] = (s.posEventCaps[ev.capKey] || 0) + ev.capAdd;
          addLogMsg(s, `✨【POS極意】「${ev.title}」達成！（${ev.rewardText}）`, 'levelup');
          if (!suppressToast) {
            pushToast(`✨ ${ev.title}`, ev.rewardText, 'sky');
          }
        }
      }

      // 5. ハイブリッド特性習得（各POS 50試合到達）
      for (const tr of POSITION_TRAITS_DEF) {
        if (s.unlockedTraits.includes(tr.id)) continue;
        if ((pm[tr.pos] || 0) >= tr.reqMatches) {
          s.unlockedTraits.push(tr.id);
          addLogMsg(s, `🎭【ハイブリッド特性習得】「${tr.name}」を永続習得！（${tr.effect}）`, 'levelup');
          if (!suppressToast) {
            pushToast(`🎭 特性習得！${tr.name}`, tr.effect, 'emerald');
          }
        }
      }

      // 6. マルチエンディング達成チェック
      for (const ed of ENDINGS_DEF) {
        if (s.unlockedEndings.includes(ed.id)) continue;
        if (ed.check(s)) {
          s.unlockedEndings.push(ed.id);
          addLogMsg(s, `📖【人生エンディング達成】${ed.code}「${ed.name}」解放！（${ed.rewardText}）`, 'levelup');
          // エンディングは本文を読ませる。300字ある文章を
          // ステータス欄の2行に押し込んでも誰も読まない。
          const writer = ENDING_FLAVOR[ed.id];
          if (writer && !s.pendingEnding) {
            try {
              s.pendingEnding = {
                id: ed.id,
                code: `📖 ${ed.code}`,
                name: `「${ed.name}」`,
                sub: '人生のエンディングを一つ見届けた',
                reward: ed.rewardText,
                text: writer(s)
              };
            } catch {
              s.pendingEnding = null;
            }
          }
          if (!suppressToast) {
            pushToast(`📖 ${ed.code}: ${ed.name}`, ed.rewardText, 'amber');
          }
        }
      }

      // 7. 神域エンドコンテンツ試練チェック
      for (const tr of ENDGAME_TRIALS_DEF) {
        if (s.completedTrials.includes(tr.id)) continue;
        if (tr.check(s)) {
          s.completedTrials.push(tr.id);
          addLogMsg(s, `🏆【神域試練達成】「${tr.name}」を制覇！（${tr.rewardText}）`, 'levelup');
          if (!suppressToast) {
            pushToast(`🏆 ${tr.name}`, tr.rewardText, 'amber');
          }
        }
      }

      clampEquippedLists(s);

      s.statCaps = computeIndividualStatCaps(
        s.generation,
        s.legacyUpgrades,
        s.achievements,
        s.position,
        s.bodyType,
        s.genomes,
        s.fusedGenomes,
        s.secretGenomes,
        s.ascensionUpgrades,
        s.endlessInvest,
        s.posEventCaps,
        s.rivalPerkCaps,
        s.completedTrials,
        s.ascensionCount || 0,
        s.unlockedEndings,
        s.completedChallenges,
        s.activeChallenge,
        s.protegeBonds,
        s.age
      );
    },
    [pushToast, addZoneCharge]
  );

  // --- 内部練習1回処理（神懸かりの閃きクリティカル搭載） ---
  const executeDrillInternal = useCallback(
    (s, drillId, suppressToast = false) => {
      const drill = DRILLS_DEF.find((d) => d.id === drillId);
      if (!drill) return false;
      if (s.activeChallenge === 'ch_pure_body' && (drillId === 'tactics_video' || drillId === 'mental_image')) {
        return false;
      }

      const { effStam, effMent, reps } = getDrillEffectiveStats(s, drill);
      if (s.stamina < effStam || s.mental < effMent) return false;

      s.stamina = Number((s.stamina - effStam).toFixed(2));
      s.mental = Number((s.mental - effMent).toFixed(2));

      const isGearBanned = s.activeChallenge === 'ch_no_gear' || s.activeChallenge === 'ch_ascetic_god';
      const u = isGearBanned ? {} : s.upgrades || {};
      const g = s.genomes || {};
      const critChance = Math.min(
        0.3,
        0.025 + (u.tactics_note || 0) * 0.004 + (g.dribbler_dna || 0) * 0.006 + (s.endlessInvest?.endless_ai || 0) * 0.003
      );
      const isCrit = nextRandom(s) < critChance;
      const critMult = isCrit ? 7.0 : 1.0;

      const memLv = s.legacyUpgrades?.growth_memory || 0;
      const stage = getCareerStageInfo(s.age, s.maxRetireAge);
      const hb = s.hobbies || {};
      const fused = s.fusedGenomes || [];
      const secret = s.secretGenomes || [];
      const syns = getActiveSynergies(s);
      const traits = s.equippedTraits || [];
      const pObj = s.life?.married ? PARTNER_TYPES[s.life.partnerType] : null;
      const isSoloCarry = s.activeChallenge === 'ch_solo_carry' || s.activeChallenge === 'ch_ascetic_god';
      const turfLv = isSoloCarry ? 0 : s.clubFacilities?.fac_turf || 0;
      const protegeObj = s.protege?.archetypeId ? PROTEGE_ARCHETYPES[s.protege.archetypeId] : null;
      const protegeBondLv = s.protege?.bondLv || 0;
      const cosmicProtegeMult = 1 + (s.ascensionUpgrades?.cosmic_protege_sync || 0) * 0.22;

      const rawMult =
        (1 + memLv * 0.11) *
        (1 + (s.ascensionUpgrades?.divine_growth_overdrive || 0) * 0.25) *
        cosmicProtegeMult *
        (1 + (g.balanced_body_dna || 0) * 0.02) *
        (1 + (g.allrounder_dna || 0) * 0.015) *
        (1 + (g.romance_bond_dna || 0) * 0.02) *
        (1 + (g.hobby_master_dna || 0) * 0.015) *
        (1 + (g.world_champ_dna || 0) * 0.03) *
        (1 + (g.jr_abroad_dna || 0) * 0.035) *
        (1 + (g.world_acad_12_dna || 0) * 0.03) *
        (1 + (g.child_daughter_genius_dna || 0) * 0.03) *
        (1 + turfLv * 0.035) *
        (1 + (s.endlessInvest?.endless_ai || 0) * 0.025) *
        (pObj?.id === 'childhood' ? 1.05 : 1.0) *
        (s.age <= 20 ? 1 + Math.min(5, g.young_pro_dna || 0) * 0.05 : 1.0) *
        (fused.includes('fused_soulmate_hobby') ? 1.14 : 1.0) *
        (fused.includes('fused_complete_body') ? 1.15 : 1.0) *
        (secret.includes('secret_time_master') ? 1.12 : 1.0) *
        (s.equippedCharms?.includes('charm_rival') ? 1.06 : 1.0) *
        (s.equippedCharms?.includes('charm_champion') ? 1.1 : 1.0) *
        (s.rivalCoopUnlocked ? 1.08 : 1.0) *
        (s.completedTrials?.includes('trial_teen_j1') ? 1.2 : 1.0) *
        (s.completedTrials?.includes('trial_cosmic_council') ? 1.6 : 1.0) *
        (s.unlockedEndings?.includes('ed_j_legend') ? 1.12 : 1.0) *
        (s.unlockedEndings?.includes('ed_cosmic_god') ? 1.4 : 1.0) *
        (s.completedChallenges?.includes('ch_no_gear') ? 1.35 : 1.0) *
        ((s.zoneFeverMonths || 0) > 0 ? 2.2 : 1.0) *
        stage.growthMult;

      // 要素を全部揃えたときの指数爆発を抑える（src/lib/softcap.js）。
      // UI予測側（getDrillEffectiveStats）と必ず同じ式にすること。
      const mult = softcap(rawMult, GROWTH_SOFTCAP.threshold, GROWTH_SOFTCAP.strength);

      const ch2BodyTecMult = s.completedChallenges?.includes('ch_pure_body') ? 1.2 : 1.0;

      const tecMult =
        (1 + (u.my_ball || 0) * 0.08) *
        (1 + (g.dribbler_dna || 0) * 0.025) *
        (1 + (g.maestro_dna || 0) * 0.025) *
        (1 + (g.jr_elite_dna || 0) * 0.04) *
        (1 + (g.j_elite_dna || 0) * 0.035) *
        (1 + (g.brazil_ginga_dna || 0) * 0.04) *
        (1 + (g.spain_cantera_dna || 0) * 0.04) *
        (1 + (g.agile_body_dna || 0) * 0.03) *
        (protegeObj?.id === 'soma' ? 1 + protegeBondLv * 0.03 : 1.0) *
        (fused.includes('fused_fantasista') ? 1.16 : 1.0) *
        (fused.includes('fused_world_brain') ? 1.16 : 1.0) *
        (secret.includes('secret_small_giant') || secret.includes('secret_sky_tower') ? 1.12 : 1.0) *
        (traits.includes('trait_wg') ? 1.1 : 1.0) *
        (syns.some((x) => x.id === 'syn_agile_trickster') ? 1.22 : 1.0) *
        ch2BodyTecMult;

      const phyMult =
        (1 + (u.agility_gear || 0) * 0.08) *
        (1 + (g.regional_jhs_dna || 0) * 0.035) *
        (1 + (g.overseas_wild_dna || 0) * 0.035) *
        (1 + (g.jfl_hungry_dna || 0) * 0.035) *
        (1 + (g.tall_body_dna || 0) * 0.03) *
        (pObj?.id === 'athlete' ? 1.07 : 1.0) *
        (fused.includes('fused_titan') ? 1.16 : 1.0) *
        ch2BodyTecMult;

      const iqMult =
        (1 + (u.tactics_note || 0) * 0.08) *
        (1 + (hb.chess || 0) * 0.05) *
        (1 + (g.maestro_dna || 0) * 0.025) *
        (1 + (g.university_iq_dna || 0) * 0.035) *
        (1 + (g.coach_mentor_dna || 0) * 0.03) *
        (1 + (g.j_elite_dna || 0) * 0.035) *
        (1 + (g.spain_cantera_dna || 0) * 0.04) *
        (protegeObj?.id === 'soma' ? 1 + protegeBondLv * 0.03 : 1.0) *
        (s.equippedCharms?.includes('charm_coach') ? 1.1 : 1.0) *
        (fused.includes('fused_fantasista') ? 1.16 : 1.0) *
        (fused.includes('fused_world_brain') ? 1.16 : 1.0);

      const shtMult =
        (1 + (u.custom_spikes || 0) * 0.08) *
        (1 + (g.striker_dna || 0) * 0.025) *
        (1 + (g.regional_jhs_dna || 0) * 0.035) *
        (1 + (g.overseas_wild_dna || 0) * 0.035) *
        (1 + (g.jfl_hungry_dna || 0) * 0.035) *
        (1 + (g.tall_body_dna || 0) * 0.03) *
        (fused.includes('fused_emperor') ? 1.16 : 1.0) *
        (fused.includes('fused_titan') ? 1.16 : 1.0);

      const additivePool = Math.min(2.5, (memLv * 0.06 + (s.totalGenerations || s.generation) * 0.025) * 0.5);
      const firstGenGrowthScale = s.generation === 1 && (s.ascensionCount || 0) === 0 ? 0.65 : 1.0;

      const prevMastery = s.mastery?.[drillId] || 0;
      const prevMLv = Math.floor(prevMastery / 30);
      const masteryBonus = getHabitMilestoneMult(prevMLv, s.completedChallenges || []);
      const baseUnit = (0.095 + additivePool * 0.12) * firstGenGrowthScale * mult * masteryBonus * reps * critMult;

      s.careerDrillCounts[drillId] = (s.careerDrillCounts[drillId] || 0) + reps;

      if (drillId === 'tech_drill') {
        applyStatGrowth(s, 'tec', baseUnit * tecMult);
      } else if (drillId === 'phy_drill') {
        applyStatGrowth(s, 'phy', baseUnit * phyMult);
        s.maxStamina = Number((s.maxStamina + 0.06 * reps * (isCrit ? 2 : 1)).toFixed(2));
      } else if (drillId === 'tactics_video') {
        applyStatGrowth(s, 'iq', baseUnit * iqMult);
        const tStyle = TACTICAL_STYLES[s.tacticalStyle] || TACTICAL_STYLES.balanced;
        const ptMult =
          (1 + (s.legacyUpgrades?.sharp_mind || 0) * 0.14) *
          (1 + (u.tactics_note || 0) * 0.1) *
          (1 + (hb.chess || 0) * 0.07) *
          (protegeObj?.id === 'soma' ? 1 + protegeBondLv * 0.06 : 1.0) *
          (s.equippedCharms?.includes('charm_coach') ? 1.28 : 1.0) *
          (fused.includes('fused_world_brain') ? 1.2 : 1.0) *
          (syns.some((x) => x.id === 'syn_total_orchestra') ? 1.3 : 1.0) *
          tStyle.ptGainMult;
        s.tactics = Number((s.tactics + 2.0 * reps * ptMult).toFixed(1));
        if (s.careerPath === 'uni_club') {
          s.careerUniPoints = (s.careerUniPoints || 0) + reps;
        }
      } else if (drillId === 'shoot_drill') {
        applyStatGrowth(s, 'sht', baseUnit * shtMult);
      } else if (drillId === 'mental_image') {
        applyStatGrowth(s, 'iq', baseUnit * 0.52 * iqMult);
        applyStatGrowth(s, 'sht', baseUnit * 0.52 * shtMult);
        s.maxMental = Number((s.maxMental + 0.06 * reps * (isCrit ? 2 : 1)).toFixed(2));
      }

      const coachStepBonus = (g.coach_mentor_dna || 0) >= 2 ? 1 : 0;
      const phoenixBonus = fused.includes('fused_phoenix') ? 1 : 0;
      const newMastery = prevMastery + (1 + coachStepBonus + phoenixBonus) * reps * (isCrit ? 3 : 1);
      s.mastery[drillId] = newMastery;

      const newMLv = Math.floor(newMastery / 30);
      if (newMLv > prevMLv && [5, 10, 20, 35, 50].includes(newMLv)) {
        const mLabel = newMLv >= 50 ? '×2.6' : newMLv >= 35 ? '×2.0' : newMLv >= 20 ? '×1.6' : newMLv >= 10 ? '×1.3' : '×1.12';
        addLogMsg(s, `📈【習慣マイルストーン】「${drill.cat}練習」熟練Lv.${newMLv}到達！成長倍率 ${mLabel} に跳躍！`, 'levelup');
        if (!suppressToast) {
          pushToast(`📈 習慣熟練Lv.${newMLv}到達！`, `${drill.cat}練習の効率が ${mLabel} に跳躍！`, 'sky');
        }
      }

      if (isCrit && !suppressToast) {
        const flavor = drill.getAgeFlavor(s.age, newMLv);
        pushToast(`⚡ 神懸かりの閃き！（成長7倍）`, `「${flavor.title}」で極意を掴み爆発成長！`, 'amber');
      }

      if (s.tacticalStyle && TACTICAL_STYLES[s.tacticalStyle]) {
        s.tacticalMastery = {
          ...(s.tacticalMastery || {}),
          [s.tacticalStyle]: ((s.tacticalMastery || {})[s.tacticalStyle] || 0) + reps
        };
      }

      s.exp += drill.expGain * reps;
      if (s.exp >= s.maxExp) {
        s.exp -= s.maxExp;
        s.level += 1;
        s.maxExp = Math.floor(s.maxExp * 1.15 + 12);
        s.maxStamina += 1;
        s.maxMental += 1;
        const { effMaxStam, effMaxMent } = getEffectiveMaxResources(s);
        s.stamina = effMaxStam;
        s.mental = effMaxMent;
      }

      if (!s.unlocks.phy_drill && s.stats.tec >= 1.2) {
        s.unlocks.phy_drill = true;
        if (s.unlocks.autoFeature && !s.autoActions.includes('phy_drill') && s.autoActions.length < s.maxAutoSlots) {
          s.autoActions = [...s.autoActions, 'phy_drill'];
        }
        const msg = '【新練習解放】基礎ドリブルが身につき「身体トレーニング（走り込み・体幹）」が解放された！';
        s.storyFlavor = msg;
        addLogMsg(s, msg, 'levelup');
        if (!suppressToast) pushToast('🔓 新練習解放！', '「身体トレーニング」が解放されました！', 'emerald');
      }
      if (!s.unlocks.tactics_video && s.stats.phy >= 1.5) {
        s.unlocks.tactics_video = true;
        s.unlocks.upgradesTab = true;
        if (s.unlocks.autoFeature && !s.autoActions.includes('tactics_video') && s.autoActions.length < s.maxAutoSlots) {
          s.autoActions = [...s.autoActions, 'tactics_video'];
        }
        const msg = '【新要素解放】「戦術研究」と下部タブ「🛒 道具・投資」が解放された！';
        s.storyFlavor = msg;
        addLogMsg(s, msg, 'levelup');
        if (!suppressToast) pushToast('🔓 新タブ解放！', '「戦術研究」＆「🛒 道具・投資」タブ解放！', 'sky');
      }
      if (!s.unlocks.shoot_drill && s.stats.iq >= 1.8) {
        s.unlocks.shoot_drill = true;
        if (s.unlocks.autoFeature && !s.autoActions.includes('shoot_drill') && s.autoActions.length < s.maxAutoSlots) {
          s.autoActions = [...s.autoActions, 'shoot_drill'];
        }
        const msg = '【新練習解放】ゴールへの道筋が見え始め「決定トレーニング（シュート練習）」が解放された！';
        s.storyFlavor = msg;
        addLogMsg(s, msg, 'levelup');
        if (!suppressToast) pushToast('🔓 新練習解放！', '「決定トレーニング」が解放されました！', 'rose');
      }
      if (!s.unlocks.mental_image && s.stats.sht >= 1.8) {
        s.unlocks.mental_image = true;
        s.unlocks.autoFeature = true;
        if (!s.autoActions.includes('tech_drill')) {
          s.autoActions = ['tech_drill'];
        }
        const msg = '【新要素解放】「精神トレーニング」と「練習AUTO自動実行」が解放された！';
        s.storyFlavor = msg;
        addLogMsg(s, msg, 'levelup');
        if (!suppressToast) pushToast('🤖 AUTO解放！', '「精神トレーニング」＆練習のAUTO自動実行が解放！', 'amber');
      }

      if ((s.legacyUpgrades?.auto_drill_switcher || 0) >= 1 && s.unlocks.autoFeature) {
        s.autoActions = computeOptimalAutoList(s);
      }

      const curRating = getTotalRating(s);
      if (curRating > (s.peakRatingReached || 0)) {
        s.peakRatingReached = curRating;
      }

      return true;
    },
    [pushToast]
  );

  // --- 公式戦シミュレーション（100周目バランス・スコア現実化・W杯・愛児共闘対応） ---
  const simulateAutoMatch = useCallback(
    (s, isCupMatch = false, suppressToast = false) => {
      const cat = CATEGORIES[s.categoryId] || CATEGORIES[0];
      const posObj = POSITIONS[s.position] || POSITIONS.CF;
      const g = s.genomes || {};
      const fused = s.fusedGenomes || [];
      const secret = s.secretGenomes || [];
      const syns = getActiveSynergies(s);
      const traits = s.equippedTraits || [];
      const tStyle = TACTICAL_STYLES[s.tacticalStyle] || TACTICAL_STYLES.balanced;
      const isGearBanned = s.activeChallenge === 'ch_no_gear' || s.activeChallenge === 'ch_ascetic_god';
      const u = isGearBanned ? {} : s.upgrades || {};
      const hb = s.hobbies || {};
      const pObj = s.life?.married ? PARTNER_TYPES[s.life.partnerType] : null;
      const fanRank = getFanRankInfo(s.fans || 0);

      const streakOppScale = 1 + Math.min(0.65, (s.winStreak || 0) * 0.04);
      const rating = getTotalRating(s);
      const dynamicFloor = Math.max(cat.oppPower, rating * 0.62);
      const oppPower = dynamicFloor * streakOppScale * (isCupMatch ? 1.15 : 1.0);

      const isSoloCarry = s.activeChallenge === 'ch_solo_carry' || s.activeChallenge === 'ch_ascetic_god';
      const mates = isSoloCarry ? {} : s.clubMates || {};
      const mateGk = mates.mate_gk || 1;
      const mateCb = mates.mate_cb || 1;
      const mateCmf = mates.mate_cmf || 1;
      const mateWg = mates.mate_wg || 1;
      const mateFw = mates.mate_fw || 1;
      const mateSum = mateGk + mateCb + mateCmf + mateWg + mateFw;
      const revMult = fused.includes('fused_revolution') ? 1.25 : 1.0;
      const trialClubMult = s.completedTrials?.includes('trial_local_god') ? 1.5 : 1.0;
      const ch6ClubMult = s.completedChallenges?.includes('ch_solo_carry') ? 1.65 : 1.0;
      const clubSupportBase = isSoloCarry
        ? 1.0
        : (1 + ((s.localClubLv || 1) - 1) * 0.04 + (mateSum - 5) * 0.008 + (g.local_club_dna || 0) * 0.04) *
          revMult *
          trialClubMult *
          ch6ClubMult *
          (s.equippedCharms?.includes('charm_club') ? 1.18 : 1.0);

      const mateDuoCombo =
        !isSoloCarry && mateGk >= 3 && mateCb >= 3 && mateCmf >= 3 && mateWg >= 3 && mateFw >= 3
          ? 1.15
          : !isSoloCarry && ((mateFw >= 3 && mateWg >= 3) || (mateGk >= 3 && mateCb >= 3))
            ? 1.07
            : 1.0;

      const tacLv = Math.floor(((s.tacticalMastery || {})[s.tacticalStyle] || 0) / 25);
      const tacMasteryBonus = 1 + tacLv * 0.015;
      const euroLv = s.categoryId >= 12 ? Math.floor(((s.euroMastery || {})[s.euroCountry] || 0) / 10) : 0;
      const euroCountryObj = s.categoryId >= 12 ? EURO_COUNTRIES[s.euroCountry] : null;
      const euroBonus =
        euroCountryObj?.id === 'france' ? 1.06 + euroLv * 0.02 : euroLv > 0 ? 1 + euroLv * 0.02 : 1.0;

      const protegeObj = s.protege?.archetypeId ? PROTEGE_ARCHETYPES[s.protege.archetypeId] : null;
      const protegeBondLv = s.protege?.bondLv || 0;
      const cosmicProtegeMult = 1 + (s.ascensionUpgrades?.cosmic_protege_sync || 0) * 0.35;
      const protegeGlobalMult =
        protegeObj?.id === 'kanade' ? 1 + protegeBondLv * 0.025 * cosmicProtegeMult : 1.0;

      const childGlobalMult = s.life?.childActive ? 1.12 : 1.0;

      const rawGlobalPowerMult =
        (1 + (g.iron_will_dna || 0) * 0.02) *
        (1 + (g.allrounder_dna || 0) * 0.02) *
        (1 + (g.total_player_dna || 0) * 0.015) *
        (1 + (g.family_guardian_dna || 0) * 0.025) *
        (1 + (g.euro_cc_dna || 0) * 0.03) *
        (1 + Math.min(5, g.underdog_hero_dna || 0) * 0.02) *
        (1 + Math.min(5, g.famous_youth_dna || 0) * 0.03) *
        (1 + Math.min(5, g.galaxy_cantera_15_dna || 0) * 0.03) *
        (1 + Math.min(5, g.euro_survival_dna || 0) * 0.03) *
        (1 + ((s.relations?.teamChem || 1) - 1) * 0.015) *
        (1 + (u.custom_spikes || 0) * 0.015) *
        (1 + (s.ascensionUpgrades?.divine_auto_overdrive || 0) * 0.1) *
        (1 + (s.ascensionUpgrades?.cosmic_genesis_engine || 0) * 0.22) *
        (1 + (s.endlessInvest?.endless_fund || 0) * 0.02) *
        (1 + (s.intlCupsWon || 0) * 0.05) *
        clubSupportBase *
        mateDuoCombo *
        tacMasteryBonus *
        euroBonus *
        protegeGlobalMult *
        childGlobalMult *
        fanRank.powerMult *
        (pObj?.id === 'athlete' ? 1.07 : 1.0) *
        (fused.includes('fused_fantasista') ? 1.05 : 1.0) *
        (fused.includes('fused_total_football') ? 1.09 : 1.0) *
        (fused.includes('fused_phoenix') ? 1.1 : 1.0) *
        (s.equippedCharms?.includes('charm_cup') ? 1.1 : 1.0) *
        (s.completedTrials?.includes('trial_genesis_god') ? 1.25 : 1.0) *
        (s.unlockedEndings?.includes('ed_parent_child') ? 1.15 : 1.0) *
        (s.unlockedEndings?.includes('ed_cosmic_god') ? 1.3 : 1.0) *
        (s.completedChallenges?.includes('ch_pure_body') ? 1.3 : 1.0) *
        (s.completedChallenges?.includes('ch_ascetic_god') ? 1.5 : 1.0) *
        (traits.includes('trait_cmf') ? 1.08 : 1.0) *
        (syns.some((x) => x.id === 'syn_total_orchestra') ? 1.15 : 1.0) *
        (syns.some((x) => x.id === 'syn_rival_eternal') ? 1.16 : 1.0) *
        ((s.zoneFeverMonths || 0) > 0 ? 1.3 : 1.0);

      // 30個以上の倍率を素直に掛けると指数で爆発する（src/lib/softcap.js）
      const globalPowerMult = softcap(rawGlobalPowerMult, POWER_SOFTCAP.threshold, POWER_SOFTCAP.strength);

      const underdogBoost =
        oppPower > rating
          ? 1 +
            (g.rival_crusher_dna || 0) * 0.035 +
            Math.min(5, g.grassroots_dna || 0) * 0.04 +
            (fused.includes('fused_eternal_rival') ? 0.18 : 0) +
            (s.equippedCharms?.includes('charm_rival') ? 0.12 : 0) +
            (traits.includes('trait_cb') ? 0.08 : 0) +
            (syns.some((x) => x.id === 'syn_rival_eternal') ? 0.22 : 0) +
            (syns.some((x) => x.id === 'syn_catenaccio_wall') ? 0.18 : 0)
          : 1.0;

      const shootPower =
        (s.stats.sht * 0.65 + s.stats.tec * 0.35) *
        tStyle.shootMult *
        (1 + (g.striker_dna || 0) * 0.025) *
        (1 + (g.giant_body_dna || 0) * 0.03) *
        (1 + (g.child_son_prodigy_dna || 0) * 0.04) *
        (1 + (hb.golf || 0) * 0.04) *
        (1 + (mateFw - 1) * 0.025) *
        (protegeObj?.id === 'ren' ? 1 + protegeBondLv * 0.03 * cosmicProtegeMult : 1.0) *
        (fused.includes('fused_emperor') ? 1.18 : 1.0) *
        (fused.includes('fused_titan') ? 1.1 : 1.0) *
        (secret.includes('secret_sky_tower') ? 1.18 : 1.0) *
        (traits.includes('trait_cf') ? 1.14 : 1.0) *
        (traits.includes('trait_wg') ? 1.09 : 1.0) *
        (syns.some((x) => x.id === 'syn_giant_aerial') ? 1.16 : 1.0) *
        (syns.some((x) => x.id === 'syn_gegen_beast') ? 1.18 : 1.0) *
        globalPowerMult *
        underdogBoost;

      const midPower =
        (s.stats.tec * 0.5 + s.stats.iq * 0.5) *
        tStyle.midMult *
        (1 + (g.team_synergy_dna || 0) * 0.03) *
        (1 + (mateCmf - 1) * 0.025 + (mateWg - 1) * 0.02) *
        (secret.includes('secret_sky_tower') ? 1.18 : 1.0) *
        (traits.includes('trait_wg') ? 1.09 : 1.0) *
        (traits.includes('trait_omf') ? 1.14 : 1.0) *
        (traits.includes('trait_sb') ? 1.1 : 1.0) *
        globalPowerMult *
        underdogBoost;

      const defPower =
        (s.stats.phy * 0.65 + s.stats.iq * 0.35) *
        tStyle.defMult *
        (1 + (g.fortress_dna || 0) * 0.03) *
        (1 + (g.team_synergy_dna || 0) * 0.03) *
        (1 + (mateGk - 1) * 0.028 + (mateCb - 1) * 0.025) *
        (protegeObj?.id === 'raizo' ? 1 + protegeBondLv * 0.04 * cosmicProtegeMult : 1.0) *
        (euroCountryObj?.id === 'italy' ? 1.12 : 1.0) *
        (fused.includes('fused_aegis') ? 1.18 : 1.0) *
        (secret.includes('secret_small_giant') ? 1.24 : 1.0) *
        (traits.includes('trait_sb') ? 1.1 : 1.0) *
        (traits.includes('trait_cb') ? 1.16 : 1.0) *
        (traits.includes('trait_gk') ? 1.18 : 1.0) *
        (syns.some((x) => x.id === 'syn_giant_aerial') ? 1.16 : 1.0) *
        (syns.some((x) => x.id === 'syn_catenaccio_wall') ? 1.28 : 1.0) *
        globalPowerMult *
        underdogBoost;

      // 序盤の周回は「才能がない」状態。何周かしないと戦えるようにならない。
      //
      // 本人の指摘（2026-11-26）:
      //   「1週目から勝ったりゴールしたり活躍しすぎ。もっと激よわなんもできない選手だった
      //     悔しさを2週目以降で晴らす構成。2週とか3週程度では全く才能が無いので
      //     まだまだダメ選手って感じにしたい。2週目で勝ち越すような戦績ではダメ」
      //
      // 1周目 0.28 / 2周目 0.45 / 3周目 0.62 / 4周目 0.80 / 5周目以降は素。
      // 上位転生を経ていれば、この縛りは外れる（もう別次元の存在なので）。
      const EARLY_GEN_POWER = [0.28, 0.45, 0.62, 0.8];
      const earlyGenScale =
        (s.ascensionCount || 0) >= 1 ? 1.0 : EARLY_GEN_POWER[(s.generation || 1) - 1] ?? 1.0;
      const myTeamPower =
        (shootPower * posObj.matchWeight.shoot +
          midPower * posObj.matchWeight.mid +
          defPower * posObj.matchWeight.def) *
        4.0 *
        earlyGenScale;
      const ratio = myTeamPower / Math.max(1, oppPower);

      let myXg =
        ratio <= 1.0
          ? 1.1 * Math.pow(Math.max(0.1, ratio), 1.25)
          : 1.1 + 2.2 * Math.tanh((ratio - 1.0) * 0.7) + 0.4 * Math.log1p(ratio - 1.0);
      if (traits.includes('trait_cf')) myXg *= 1.12;
      if (syns.some((x) => x.id === 'syn_giant_aerial')) myXg *= 1.1;
      myXg = Math.min(5.2, Math.max(0.15, myXg));

      let oppXg = 1.2 / Math.pow(Math.max(0.35, ratio), 1.12);
      if (traits.includes('trait_gk')) oppXg *= 0.85;
      oppXg = Math.min(4.6, Math.max(0.08, oppXg));

      const sampleGoals = (lam) => {
        const L = Math.exp(-lam);
        let k = 0;
        let p = 1.0;
        while (k < 7) {
          k += 1;
          p *= nextRandom(s);
          if (p <= L) break;
        }
        return Math.min(6, k - 1);
      };

      const myGoals = sampleGoals(myXg);
      const oppGoals = sampleGoals(oppXg);
      const isWin = myGoals > oppGoals;
      const isDraw = myGoals === oppGoals;

      const isIntlCupYear = isCupMatch && s.month === 12 && s.age >= 18 && s.age % 4 === 2 && s.categoryId >= 11;

      s.matchesPlayed += 1;
      s.careerTotalMatches = (s.careerTotalMatches || 0) + 1;
      s.careerPosMatches[s.position] = (s.careerPosMatches[s.position] || 0) + 1;

      if (['CB', 'GK', 'SB'].includes(s.position)) {
        s.careerDefMatches = (s.careerDefMatches || 0) + 1;
      }
      if (s.careerPath === 'overseas_acad') {
        s.careerPathMatches.overseas_acad = (s.careerPathMatches.overseas_acad || 0) + 1;
      }
      if (s.categoryId >= 12 && s.euroCountry) {
        s.euroMastery = {
          ...(s.euroMastery || {}),
          [s.euroCountry]: ((s.euroMastery || {})[s.euroCountry] || 0) + (isWin ? 2 : 1)
        };
      }

      // ポジションごとに取れる数字が違う。
      // 本人の指摘（2026-11-26）:
      //   「GKでもゴール数が増えていくのはおかしい。それぞれのポジションでスタッツは異なる。
      //     GKなのに点が取れる＝無双、とするのはいいが、
      //     宇宙規模の強さになった時でないとおかしい」
      //
      // 銀河系リーグ（cat15）以上、または上位転生を経た存在だけが、
      // ポジションを無視して点を取れる。
      const baseShare = posObj.statShare || { goal: 0.2, assist: 0.2 };
      const isCosmic = s.categoryId >= 15 || (s.ascensionCount || 0) >= 1;
      const goalShare = isCosmic ? Math.max(baseShare.goal, 0.4) : baseShare.goal;
      const assistShare = isCosmic ? Math.max(baseShare.assist, 0.3) : baseShare.assist;
      let myG = 0;
      let myA = 0;
      for (let i = 0; i < myGoals; i++) {
        if (nextRandom(s) < goalShare) myG += 1;
        else if (nextRandom(s) < assistShare) myA += 1;
      }
      myG = Math.min(3, myG);
      myA = Math.min(2, myA);

      if (s.bodyType === 'giant' && ['OMF', 'WG'].includes(s.position)) {
        s.secretGiantAtkContrib = (s.secretGiantAtkContrib || 0) + myG + myA;
      }

      if (s.life?.childActive) {
        s.life.childRating = Number(((s.life.childRating || 18) + (isWin ? 1.4 : 0.5)).toFixed(1));
        if (isWin) {
          if (s.life.childGender === 'daughter') {
            s.careerDaughterWins = (s.careerDaughterWins || 0) + 1;
          } else {
            s.careerSonWins = (s.careerSonWins || 0) + 1;
          }
        }
      }

      s.goals += myG;
      s.assists += myA;
      s.totalCareerGoals = (s.totalCareerGoals || 0) + myG;
      s.totalCareerAssists = (s.totalCareerAssists || 0) + myA;

      const isMom = isWin && (myG + myA >= 2 || (['CB', 'GK'].includes(s.position) && oppGoals === 0));
      if (isMom) s.momCount += 1;

      const feverMoneyMult = (s.zoneFeverMonths || 0) > 0 ? 1.6 : 1.0;
      const activeMoneyMult =
        (1 + (u.sponsor_deal || 0) * 0.12) *
        (1 + (hb.supercar || 0) * 0.08) *
        (1 + (g.hobby_master_dna || 0) * 0.04) *
        (1 + (g.local_club_dna || 0) * 0.05) *
        (1 + Math.min(5, g.euro_top_18_dna || 0) * 0.05) *
        (1 + (s.clubFacilities?.fac_scout || 0) * 0.05) *
        (euroCountryObj?.id === 'england' ? 1.12 : 1.0) *
        (pObj?.id === 'announcer' ? 1.15 : pObj?.id === 'actress' ? 1.22 : 1.0) *
        (fused.includes('fused_soulmate_hobby') ? 1.18 : 1.0) *
        (s.equippedCharms?.includes('charm_cup') ? 1.18 : 1.0) *
        (s.unlockedEndings?.includes('ed_euro_king') ? 1.2 : 1.0) *
        (syns.some((x) => x.id === 'syn_hometown_hero') ? 1.35 : 1.0) *
        feverMoneyMult;

      const fanMult =
        (1 + (u.school_clinic || 0) * 0.1) *
        (1 + (hb.supercar || 0) * 0.12) *
        (1 + (g.media_star_dna || 0) * 0.08) *
        (1 + (s.clubFacilities?.fac_scout || 0) * 0.08) *
        (protegeObj?.id === 'kanade' ? 1 + protegeBondLv * 0.06 : 1.0) *
        (euroCountryObj?.id === 'france' ? 1.2 : 1.0) *
        (pObj?.id === 'announcer' ? 1.2 : 1.0) *
        getUnrivaledRank(s.age, rating, s.totalGenerations || s.generation).fanMult;

      if (isWin) {
        s.wins += 1;
        s.winStreak += 1;
        s.careerWins = (s.careerWins || 0) + 1;
        s.careerBodyWins[s.bodyType] = (s.careerBodyWins[s.bodyType] || 0) + 1;
        if (s.careerPath) {
          s.careerPathWins[s.careerPath] = (s.careerPathWins[s.careerPath] || 0) + 1;
        }
        if (s.careerPath === 'uni_club') {
          s.careerUniPoints = (s.careerUniPoints || 0) + 2;
        }
        if (s.categoryId >= 13) {
          s.careerEuroCcWins = (s.careerEuroCcWins || 0) + 1;
        }
        if (s.categoryId >= 14) {
          s.careerWorldWins = (s.careerWorldWins || 0) + 1;
        }
        if (s.age >= 35) {
          s.secretVeteranWins = (s.secretVeteranWins || 0) + 1;
        }
        if (s.bodyType === 'agile' && ['GK', 'CB'].includes(s.position)) {
          s.secretSmallDefWins = (s.secretSmallDefWins || 0) + 1;
        }

        addZoneCharge(s, isIntlCupYear ? 45 : isCupMatch ? 24 : 11, suppressToast);

        if (isCupMatch) {
          s.cupsWon = (s.cupsWon || 0) + 1;
          if (s.cupsWon >= 3 && !s.unlockedCharms.includes('charm_cup')) {
            s.unlockedCharms = [...s.unlockedCharms, 'charm_cup'];
            if (!suppressToast) {
              pushToast('🏅 絆のお守り獲得', '「黄金キャプテンマーク」を獲得した！', 'amber');
            }
          }
          if (s.careerPath === 'underdog_hs') {
            s.careerUnderdogCups = (s.careerUnderdogCups || 0) + 1;
          }
        }
        if (isIntlCupYear) {
          s.intlCupsWon = (s.intlCupsWon || 0) + 1;
          if (!suppressToast) {
            pushToast(
              `🌍🏆 インターナショナル・カップ優勝！(通算${s.intlCupsWon}度目)`,
              '永久トロフィー効果：全戦力+5% / 獲得結晶+8% が加算！',
              'amber'
            );
          }
        }

        const streakBonus = 1 + Math.min(1.0, s.winStreak * 0.06);
        const momMult = isMom ? 1.45 : 1.0;
        const cupMult = isIntlCupYear ? 4.0 : isCupMatch ? 2.1 : 1.0;
        const rewardG = Math.round(cat.baseReward * activeMoneyMult * streakBonus * momMult * cupMult);
        const gainFans = Math.round(cat.fanGain * fanMult * momMult * cupMult);

        s.money += rewardG;
        s.fans += gainFans;
        s.tactics = Number(
          (s.tactics + (isIntlCupYear ? 15 : isCupMatch ? 5 : 2) * feverMoneyMult * tStyle.ptGainMult).toFixed(1)
        );

        const activeRivalTitle =
          s.categoryId >= 12
            ? EURO_COUNTRIES[s.euroCountry]?.rivalName || '欧州スター'
            : RIVAL_TIERS[s.rival?.tierIdx || 0]?.name || '宿敵';

        s.lastMatchReport = {
          result: 'WIN',
          score: `${myGoals}-${oppGoals}`,
          isCup: isCupMatch,
          isMom,
          myG,
          myA,
          rewardG,
          note: `${
            isIntlCupYear
              ? '🌍🏆 インターナショナル・カップ世界制覇！'
              : isCupMatch
                ? `🏆宿敵(${activeRivalTitle})撃破カップ優勝！`
                : '公式戦勝利'
          }（${s.winStreak}連勝） +${formatYen(rewardG)}`
        };

        if (isCupMatch || isMom) {
          const highlights = isIntlCupYear
            ? [
                `後半ロスタイム：4年に1度の世界インターナショナル・カップ決勝、世界の強豪と死闘！`,
                `「これが俺たちのフットボールだ！」${s.playerName}のスーパーゴールで世界王座を掴み取った！`,
                `試合終了：${myGoals}-${oppGoals}で世界制覇！永久トロフィー（戦力+5%/結晶+8%）を獲得！`
              ]
            : isCupMatch
              ? [
                  `前半34分：カップ決勝の舞台で宿敵「${activeRivalTitle}」と激しく火花を散らす！`,
                  `後半81分：${s.playerName}が宿敵のマークを振り切り、決勝ゴールを叩き込む！`,
                  `試合終了：${myGoals}-${oppGoals}で宿敵を撃破しカップ制覇！観客が総立ちで歓喜！`
                ]
              : [
                  `前半28分：${
                    s.life?.childActive
                      ? `愛児(${s.life.childGender === 'daughter' ? '娘' : '息子'})との親子ワンツーから`
                      : protegeObj
                        ? `愛弟子・${protegeObj.name}との完璧なワンツーから`
                        : `${tStyle.name}の連動から`
                  }中盤を突破し決定機を演出！`,
                  `後半74分：${s.playerName}がペナルティエリア内で冷静に相手DFをかわし、ゴール隅へ突き刺す！`,
                  `試合終了：${myGoals}-${oppGoals}で劇的勝利！スタジアムが「${s.playerName}」コールに包まれた！`
                ];
          s.lastHighlightLines = highlights;
          s.storyFlavor = highlights[1];
          addLogMsg(
            s,
            `⚽ ${isIntlCupYear ? '【世界W杯制覇】' : isCupMatch ? '【カップ決勝・宿敵撃破】' : '【MOM活躍】'}${myGoals}-${oppGoals} (${myG}G${myA}A) 賞金+${formatYen(rewardG)}`,
            'match'
          );
        }
      } else if (isDraw) {
        s.winStreak = 0;
        const rewardG = Math.round(cat.baseReward * 0.45 * activeMoneyMult);
        s.money += rewardG;
        s.fans += Math.round(cat.fanGain * 0.3 * fanMult);
        s.lastMatchReport = {
          result: 'DRAW',
          score: `${myGoals}-${oppGoals}`,
          isCup: isCupMatch,
          isMom: false,
          myG,
          myA,
          rewardG,
          note: `引き分け（連勝ストップ） +${formatYen(rewardG)}`
        };
      } else {
        s.winStreak = 0;
        const rewardG = Math.round(cat.baseReward * 0.2 * activeMoneyMult);
        s.money += rewardG;
        s.lastMatchReport = {
          result: 'LOSS',
          score: `${myGoals}-${oppGoals}`,
          isCup: isCupMatch,
          isMom: false,
          myG,
          myA,
          rewardG,
          note: `惜敗（能力を鍛えて再戦だ） +${formatYen(rewardG)}`
        };
      }

      const newRating = getTotalRating(s);
      const ascCount = s.ascensionCount || 0;
      // --- 降格判定 ---
      // 衰えて今のカテゴリの要求を大きく下回ったら、下のリーグへ落ちる。
      // 最下層でも契約がもらえなくなったら、そこで現役生活が終わる。
      // 「何歳で強制引退」ではなく「通用しなくなったら引退」という形にする。
      while (s.categoryId > 0 && newRating < CATEGORIES[s.categoryId].reqRating * CONTRACT_KEEP_RATIO) {
        const fromCat = CATEGORIES[s.categoryId];
        s.categoryId -= 1;
        const toCat = CATEGORIES[s.categoryId];
        s.clubName = toCat.clubDefault;
        const relMsg = `📉【契約打ち切り】${fromCat.name}での契約を更新されず、${toCat.name}へ。「もう以前の動きではない」とコーチは言った。`;
        s.storyFlavor = relMsg;
        addLogMsg(s, relMsg, 'story');
        if (!suppressToast) {
          pushToast('📉 降格', `${toCat.name}へ落ちた`, 'rose');
        }
      }

      for (let i = s.categoryId + 1; i < CATEGORIES.length; i++) {
        const nextCat = CATEGORIES[i];
        let unlockedByAge = false;
        if (i <= 8) {
          const defaultMin = [5, 7, 12, 12, 15, 15, 18, 18, 18][i];
          const effMin = ascCount >= 2 ? 5 : ascCount >= 1 && i >= 7 ? 12 : defaultMin;
          unlockedByAge = s.age >= effMin;
        } else if (i === 9 || i === 10 || i === 11) {
          // プロ契約。飛び級でも16歳、通常は18歳（高卒）から。
          // 本人の指摘（2026-11-26）:
          //   「3週目で13歳でJ1デビュー、18歳で欧州メガクラブ、23歳でW杯優勝みたいな
          //     無双になってしまった。これは進行速度、成長速度が速すぎる」
          const effMin = ascCount >= 2 ? 5 : ascCount >= 1 ? 15 : newRating >= nextCat.reqRating * 1.5 ? 16 : 18;
          unlockedByAge = s.age >= effMin;
        } else if (i === 12 || i === 13 || i === 14) {
          // 海外・代表。労働許可の都合もあって18歳が現実的な下限
          const effMin = ascCount >= 3 ? 5 : ascCount >= 2 ? 12 : ascCount >= 1 ? 16 : 18;
          unlockedByAge = s.age >= effMin;
        } else if (i === 15 || i === 16) {
          const effMin = ascCount >= 3 ? 5 : 12;
          unlockedByAge = ascCount >= 1 && s.age >= effMin;
        } else {
          const effMin = ascCount >= 4 ? 12 : 16;
          unlockedByAge = ascCount >= 4 && s.age >= effMin;
        }

        if (unlockedByAge && newRating >= nextCat.reqRating) {
          s.categoryId = i;
          // 到達した最高カテゴリ。衰えて降格してもここは下がらない。
          // 上位転生の条件判定に使う（寿命で引退したあとでも転生できるように）
          s.peakCategoryId = Math.max(s.peakCategoryId || 0, i);
          s.clubName = nextCat.clubDefault;
          const bonus = Math.round(nextCat.baseReward * 1.6);
          s.money += bonus;
          if (i >= 9 && !s.achievements.includes('j_leaguer')) {
            s.achievements = [...s.achievements, 'j_leaguer'];
          }
          if (i >= 12 && !s.achievements.includes('overseas')) {
            s.achievements = [...s.achievements, 'overseas'];
          }
          // 「世界制覇の記念メダル」は欧州CC強豪（cat13）到達で手に入る設定なのに、
          // それを解放する処理がどこにも無く、永久に入手できなかった。
          if (i >= 13 && !s.unlockedCharms.includes('charm_champion')) {
            s.unlockedCharms = [...s.unlockedCharms, 'charm_champion'];
            addLogMsg(s, '🏅【お守り獲得】「世界制覇の記念メダル」を手に入れた！', 'levelup');
            if (!suppressToast) {
              pushToast('🏅 お守り獲得', '「世界制覇の記念メダル」を手に入れた！', 'amber');
            }
          }
          const promoFlavor = `🔥【異例の昇格劇】「${s.age}歳で${nextCat.name}に昇格だと…！？ 歴史が動いたぞ！」周囲のスカウトや記者たちが騒然としている！（祝儀 +${formatYen(bonus)}）`;
          s.storyFlavor = promoFlavor;
          addLogMsg(s, promoFlavor, 'levelup');
          if (!suppressToast) {
            pushToast(`🔥 昇格！${nextCat.name}`, `祝儀 +${formatYen(bonus)} を獲得！`, 'amber');
          }
        }
      }
    },
    [pushToast, addZoneCharge]
  );

  // --- ランダム人生遭遇イベント（未来予知競馬的中イベント含む） ---
  const triggerRandomLifeEvent = useCallback(
    (s) => {
      if (nextRandom(s) > 0.09) return;
      const rating = getTotalRating(s);
      const isOverpowered = rating >= 25 || (s.totalGenerations || s.generation) >= 2;
      const roll = nextRandom(s);
      if (roll < 0.25) {
        const gain = Number((0.22 + s.level * 0.03).toFixed(2));
        applyStatGrowth(s, 'tec', gain);
        applyStatGrowth(s, 'iq', gain);
        const txt = isOverpowered
          ? `✨【スカウト戦慄】練習試合を視察に来た名門スカウトが「なんだあの動きは…！？」とメモ帳を落として絶句！（技術・戦術 +${gain}）`
          : `✨【偶然の出会い】公園で往年の名選手と出会い、極意を教わった！（技術・戦術 +${gain}）`;
        s.storyFlavor = txt;
        addLogMsg(s, txt, 'story');
      } else if (roll < 0.5) {
        addZoneCharge(s, 20);
        const txt = '🔥【覚醒の予感】練習中のワンタッチから理想のフォームを掴んだ！（ZONE +20%）';
        s.storyFlavor = txt;
        addLogMsg(s, txt, 'story');
      } else if (roll < 0.75) {
        const prophecyBonus = (s.prophecyLv || 0) * 6500;
        const bonusG = Math.round(1500 + CATEGORIES[s.categoryId].baseReward * 0.65 + prophecyBonus);
        s.money += bonusG;
        s.stamina = Math.min(s.maxStamina, s.stamina + 8);
        const txt =
          (s.prophecyLv || 0) > 0
            ? `🐎【未来予知・大穴的中】「この年のG1レースの勝ち馬は記憶通りだ！」タイムリープ記憶の予知投資で資金+${formatYen(bonusG)}獲得！`
            : `🍙【地元商店街の激励】「${s.playerName}は町の誇りだ！」差し入れとカンパを受け取った！（+${formatYen(bonusG)}）`;
        s.storyFlavor = txt;
        addLogMsg(s, txt, 'story');
      } else {
        const bonusFans = Math.round(6 + CATEGORIES[s.categoryId].fanGain * 1.1);
        s.fans += bonusFans;
        const txt = isOverpowered
          ? `📰【SNS話題沸騰】「${s.age}歳でこのキレは次元が違う…」スーパープレー動画が拡散されファン急増！（+${formatNum(bonusFans)}人）`
          : `📰【地元紙掲載】活躍が地域のスポーツ欄で紹介されファンが増えた！（+${formatNum(bonusFans)}人）`;
        s.storyFlavor = txt;
        addLogMsg(s, txt, 'story');
      }
    },
    [addZoneCharge]
  );

  // --- 1ヶ月（1ティック）進行処理 ---
  const advanceOneMonth = useCallback(
    (newState, { suppressModals = false, suppressToast = false } = {}) => {
      if (newState.isRetired) return null;

      newState.month += 1;
      newState.matchCounter += 1;
      let birthdayTriggered = false;
      if (newState.month > 12) {
        newState.month = 1;
        newState.age += 1;
        birthdayTriggered = true;
      }

      if ((newState.zoneFeverMonths || 0) > 0) {
        newState.zoneFeverMonths = Math.max(0, newState.zoneFeverMonths - 1);
      }

      const isSoloCarry = newState.activeChallenge === 'ch_solo_carry' || newState.activeChallenge === 'ch_ascetic_god';
      const stadiumLv = isSoloCarry ? 0 : newState.clubFacilities?.fac_stadium || 0;
      const sigBrandLv = newState.brandProjects?.sig_brand || 0;
      const prophecyLv = newState.prophecyLv || 0;

      const partTimeG =
        (newState.upgrades?.part_time || 0) * 1200 + stadiumLv * 4500 + sigBrandLv * 8500 + prophecyLv * 5500;
      const clinicPt = (newState.upgrades?.school_clinic || 0) * 6 + prophecyLv * 8;
      const passiveFans = sigBrandLv * 40 + stadiumLv * 15;
      if (partTimeG > 0) newState.money += partTimeG;
      if (clinicPt > 0) newState.tactics = Number((newState.tactics + clinicPt).toFixed(1));
      if (passiveFans > 0) newState.fans += passiveFans;

      // 子どもが16歳になったらサッカーの道へ。
      //
      // 以前は「親が24歳以上」だったので、20歳で子どもができた直後に
      // 4歳児がプロデビューしていた（本人指摘 2026-11-20）。
      // childBornAge のないセーブは、従来どおり親20歳で生まれた扱いにする。
      const childBorn = newState.life?.childBornAge || 20;
      if (newState.life?.hasChild && !newState.life?.childActive && newState.age >= childBorn + 16) {
        const isDaughter = nextRandom(newState) < 0.5;
        const talents = isDaughter
          ? ['天賦の司令塔タイプ', '音速ウインガータイプ', '天才ファンタジスタタイプ']
          : ['剛腕ストライカータイプ', '鉄壁センターバックタイプ', '無尽蔵エンジンタイプ'];
        const chosenTalent = talents[Math.floor(nextRandom(newState) * talents.length)];
        newState.life = {
          ...newState.life,
          status: `親子二代現役選手（${isDaughter ? '娘' : '息子'}デビュー済）`,
          childActive: true,
          childGender: isDaughter ? 'daughter' : 'son',
          childTalent: chosenTalent,
          childRating: Math.max(16, Math.round(getTotalRating(newState) * 0.42))
        };
        const childMsg = `⚽【親子二代・自動プロデビュー】成長した愛児（${isDaughter ? '娘' : '息子'}・${chosenTalent}）が自らサッカーの道を選びプロデビュー！親子共闘がスタート！`;
        newState.storyFlavor = childMsg;
        addLogMsg(newState, childMsg, 'levelup');
        if (!suppressToast) {
          pushToast(
            `⚽ 愛児（${isDaughter ? '娘' : '息子'}）サッカーデビュー！`,
            `${chosenTalent}として共に戦い、固有二世ゲノムが成長！`,
            'amber'
          );
        }
      }

      // 「恩人の顔を覚えている」の支援金。15歳の春に一度だけ。
      //
      // 子どものうちは小遣い程度しか動かせない（docs/GAME_DESIGN.md §3）ので、
      // 初期資金の強化だけだと、使える頃にはもう試合の賞金のほうが大きい。
      // 15歳という「道具が効き始める時期」に、まとまった額が入る形にする。
      if (newState.age === 15 && !newState.patronPaid) {
        const patronLv = newState.legacyUpgrades?.patron_memory || 0;
        if (patronLv > 0) {
          const gain = Math.floor(60000 * Math.pow(2.3, patronLv - 1));
          newState.money += gain;
          newState.patronPaid = true;
          const pMsg = `🤝【恩人の訪問】前の人生で世話になった人物を訪ねた。向こうは初対面のつもりでいる。支援金 ${formatYen(gain)} を受け取った。`;
          newState.storyFlavor = pMsg;
          addLogMsg(newState, pMsg, 'story');
          if (!suppressToast) {
            pushToast('🤝 支援金', formatYen(gain), 'emerald');
          }
        }
      }

      // 誕生月ごとに年齢上限リミッター再計算
      if (birthdayTriggered) {
        newState.statCaps = computeIndividualStatCaps(
          newState.generation,
          newState.legacyUpgrades,
          newState.achievements,
          newState.position,
          newState.bodyType,
          newState.genomes,
          newState.fusedGenomes,
          newState.secretGenomes,
          newState.ascensionUpgrades,
          newState.endlessInvest,
          newState.posEventCaps,
          newState.rivalPerkCaps,
          newState.completedTrials,
          newState.ascensionCount || 0,
          newState.unlockedEndings,
          newState.completedChallenges,
          newState.activeChallenge,
          newState.protegeBonds,
          newState.age
        );
      }

      // 縛りチャレンジ達成即判定
      if (newState.activeChallenge) {
        const chDef = CHALLENGES_DEF.find((c) => c.id === newState.activeChallenge);
        if (chDef && !newState.completedChallenges.includes(chDef.id) && chDef.checkGoal(newState)) {
          newState.completedChallenges = [...newState.completedChallenges, chDef.id];
          const chMsg = `⚔️【縛りチャレンジ制覇】${chDef.code}「${chDef.name}」の目標を達成！（${chDef.rewardText}）`;
          newState.storyFlavor = chMsg;
          addLogMsg(newState, chMsg, 'levelup');
          if (!suppressToast) {
            pushToast(`⚔️ ${chDef.code} 制覇！`, chDef.rewardText, 'amber');
          }
        }
      }

      // 自然回復
      const isGearBanned = newState.activeChallenge === 'ch_no_gear' || newState.activeChallenge === 'ch_ascetic_god';
      const u = isGearBanned ? {} : newState.upgrades || {};
      const g = newState.genomes || {};
      const fused = newState.fusedGenomes || [];
      const syns = getActiveSynergies(newState);
      const traits = newState.equippedTraits || [];
      const hb = newState.hobbies || {};
      const pObj = newState.life?.married ? PARTNER_TYPES[newState.life.partnerType] : null;
      const cafeLv = isSoloCarry ? 0 : newState.clubFacilities?.fac_cafeteria || 0;

      const commonRecMult =
        (1 + (u.bento_protein || 0) * 0.12) *
        (1 + (hb.cooking || 0) * 0.07) *
        (1 + (g.jr_local_dna || 0) * 0.04) *
        (1 + cafeLv * 0.06) *
        (pObj?.id === 'childhood' ? 1.08 : 1.0) *
        (newState.equippedCharms?.includes('charm_lover') ? 1.22 : 1.0) *
        (newState.unlockedEndings?.includes('ed_eternal_50') ? 1.18 : 1.0) *
        (traits.includes('trait_sb') ? 1.12 : 1.0) *
        (syns.some((x) => x.id === 'syn_iron_dynamo') ? 1.3 : 1.0);

      const stamRec =
        (4.0 + newState.maxStamina * 0.075) *
        commonRecMult *
        (1 + (g.engine_dna || 0) * 0.04) *
        (fused.includes('fused_total_football') ? 1.16 : 1.0);

      const mentRec =
        (4.0 + newState.maxMental * 0.075) *
        commonRecMult *
        (1 + (g.guardian_dna || 0) * 0.04) *
        (1 + (g.romance_bond_dna || 0) * 0.04) *
        (fused.includes('fused_aegis') ? 1.16 : 1.0);

      const { effMaxStam, effMaxMent } = getEffectiveMaxResources(newState);
      newState.stamina = Number(Math.min(effMaxStam, newState.stamina + stamRec).toFixed(2));
      newState.mental = Number(Math.min(effMaxMent, newState.mental + mentRec).toFixed(2));

      // QoL自動化⓪：輪廻の代理人（継承結晶の強化を自動購入）
      //
      // 本人の要望（2026-11-23）:
      //   「二次転生に永続ブレイクスルーや1次転生結晶商品を自動購入するアイテムも追加するか。
      //     強くするほど便利になり、さらに新しい要素が解放される」
      //
      // 安いものから順に、買えるものを毎月1つだけ。
      // 一気に全部買わないのは、何を買ったかがログで追えなくなるため。
      if ((newState.ascensionUpgrades?.divine_legacy_agent || 0) >= 1) {
        const buyable = LEGACY_UPGRADES_DEF.filter((upg) => {
          if (upg.requiresId && (newState.legacyUpgrades?.[upg.requiresId] || 0) < 1) return false;
          const curLv = newState.legacyUpgrades?.[upg.id] || 0;
          if (curLv >= upg.maxLv) return false;
          const cost = Math.floor(upg.baseCost * Math.pow(upg.growth, curLv));
          return (newState.legacyPoints || 0) >= cost;
        });
        if (buyable.length > 0) {
          const cheapest = buyable.reduce((best, upg) => {
            const c = Math.floor(upg.baseCost * Math.pow(upg.growth, newState.legacyUpgrades?.[upg.id] || 0));
            const bc = Math.floor(best.baseCost * Math.pow(best.growth, newState.legacyUpgrades?.[best.id] || 0));
            return c < bc ? upg : best;
          }, buyable[0]);
          const curLv = newState.legacyUpgrades?.[cheapest.id] || 0;
          const cost = Math.floor(cheapest.baseCost * Math.pow(cheapest.growth, curLv));
          newState.legacyPoints = (newState.legacyPoints || 0) - cost;
          newState.legacyUpgrades = { ...(newState.legacyUpgrades || {}), [cheapest.id]: curLv + 1 };
          addLogMsg(newState, `♻️【輪廻の代理人】「${cheapest.name}」Lv.${curLv + 1} を自動購入（💎-${cost}）`, 'info');
        }
      }

      // QoL自動化⓪b：覚醒の代理人（永続ブレイクスルーを自動購入）
      if (
        (newState.ascensionUpgrades?.divine_breakthrough_agent || 0) >= 1 &&
        newState.activeChallenge !== 'ch_no_memory' &&
        newState.activeChallenge !== 'ch_ascetic_god'
      ) {
        for (const bt of BREAKTHROUGHS_DEF) {
          if (newState.breakthroughs?.[bt.id]) continue;
          if (newState.money < bt.costMoney || newState.tactics < bt.costTactics) continue;
          newState.money -= bt.costMoney;
          newState.tactics = Number((newState.tactics - bt.costTactics).toFixed(1));
          newState.breakthroughs = { ...(newState.breakthroughs || {}), [bt.id]: true };
          // 購入ハンドラ側と同じ副作用を入れる。ここだけ抜けると
          // 「買ったのにAUTOが増えない」という食い違いが出る
          if (bt.id === 'smart_auto_all') {
            newState.unlocks = { ...newState.unlocks, autoFeature: true };
            newState.maxAutoSlots = 5;
            newState.autoActions = ALL_DRILL_IDS.filter((id) => newState.unlocks[id]);
          }
          addLogMsg(newState, `✨【覚醒の代理人】永続ブレイクスルー「${bt.name}」を自動習得`, 'levelup');
          break;
        }
      }

      // QoL自動化①：専属マネージャー（道具自動購入）
      if (
        !isGearBanned &&
        (newState.legacyUpgrades?.auto_gear_agent || 0) >= 1 &&
        newState.qolToggles?.autoGearBuy !== false
      ) {
        for (const upg of UPGRADES_DEF) {
          if (upg.minAge && newState.age < upg.minAge) continue;
          if (upg.minCat && newState.categoryId < upg.minCat) continue;
          if (upg.minFans && (newState.fans || 0) < upg.minFans) continue;
          const curLv = newState.upgrades?.[upg.id] || 0;
          if (curLv >= upg.maxLv) continue;
          const costG = Math.floor(upg.baseG * Math.pow(upg.growth, curLv));
          const costPt = Math.floor(upg.basePt * Math.pow(upg.growth, curLv));
          if (newState.money >= costG * 1.4 && newState.tactics >= costPt * 1.2) {
            newState.money -= costG;
            newState.tactics = Number((newState.tactics - costPt).toFixed(1));
            newState.upgrades[upg.id] = curLv + 1;
            if (upg.id === 'agility_gear') newState.maxStamina += 4;
            if (upg.id === 'ai_schedule') {
              const memLv = newState.legacyUpgrades?.tactical_memory || 0;
              const nextMax = newState.breakthroughs?.smart_auto_all
                ? 5
                : Math.min(5, 1 + memLv + Math.min(4, curLv + 1));
              newState.maxAutoSlots = nextMax;
              if (newState.unlocks.autoFeature) {
                const candidate = ALL_DRILL_IDS.find((id) => newState.unlocks[id] && !newState.autoActions.includes(id));
                if (candidate && newState.autoActions.length < nextMax) {
                  newState.autoActions = [...newState.autoActions, candidate];
                }
              }
            }
            break;
          }
        }
      }

      // QoL自動化②：敏腕秘書（交流・師弟・お守り＆特性自動装備）
      const secLv = newState.legacyUpgrades?.auto_social_secretary || 0;
      const isSocialBanned = newState.activeChallenge === 'ch_lone_wolf' || newState.activeChallenge === 'ch_ascetic_god';
      if (secLv >= 1 && newState.qolToggles?.autoSocialRun !== false) {
        const maxC = computeMaxCharmSlots(newState.legacyUpgrades, newState.ascensionUpgrades, newState.genomes);
        if ((newState.equippedCharms?.length || 0) < maxC) {
          const unequipped = (newState.unlockedCharms || []).find((id) => !(newState.equippedCharms || []).includes(id));
          if (unequipped) {
            newState.equippedCharms = [...(newState.equippedCharms || []), unequipped];
          }
        }
        const maxT = computeMaxTraitSlots(
          newState.ascensionCount || 0,
          newState.ascensionUpgrades,
          newState.legacyUpgrades,
          newState.breakthroughs
        );
        if ((newState.equippedTraits?.length || 0) < maxT) {
          const unequippedT = (newState.unlockedTraits || []).find((id) => !(newState.equippedTraits || []).includes(id));
          if (unequippedT) {
            newState.equippedTraits = [...(newState.equippedTraits || []), unequippedT];
          }
        }
        if (newState.stamina >= newState.maxStamina * 0.85 && newState.mental >= newState.maxMental * 0.85) {
          newState.stamina = Number((newState.stamina - 12).toFixed(2));
          newState.mental = Number((newState.mental - 10).toFixed(2));
          const myPow = getTotalRating(newState);
          const rivPow =
            newState.categoryId >= 12
              ? EURO_COUNTRIES[newState.euroCountry]?.rivalRating || 1150
              : newState.rival?.rating || 18;
          if (myPow >= rivPow * 0.94) {
            newState.rival = {
              ...(newState.rival || {}),
              winsAgainst: (newState.rival?.winsAgainst || 0) + 1,
              rating: Math.round(rivPow * 1.12 + 8)
            };
            newState.careerRivalWins = (newState.careerRivalWins || 0) + 1;
            if (newState.categoryId < 12) {
              const autoTier = RIVAL_TIERS[newState.rival?.tierIdx || 0];
              applyRivalMilestone(
                newState,
                autoTier,
                newState.rival.winsAgainst || 0,
                suppressToast ? null : pushToast
              );
            }
          }
        }
        if (!isSocialBanned) {
          if (newState.tactics >= 60 && newState.mental >= newState.maxMental * 0.8) {
            newState.tactics = Number((newState.tactics - 25).toFixed(1));
            newState.mental = Number((newState.mental - 8).toFixed(2));
            applyStatGrowth(newState, 'iq', 0.25);
            newState.relations.coachTrust = (newState.relations.coachTrust || 1) + 1;
            newState.careerCoachLessons = (newState.careerCoachLessons || 0) + 1;
          }
          const protegeMonth = newState.age * 12 + newState.month;
          if (
            newState.protege?.archetypeId &&
            newState.lastProtegeMonth !== protegeMonth &&
            newState.tactics >= 50 &&
            newState.stamina >= newState.maxStamina * 0.8
          ) {
            const pId = newState.protege.archetypeId;
            newState.lastProtegeMonth = protegeMonth;
            newState.tactics = Number((newState.tactics - 20).toFixed(1));
            newState.stamina = Number((newState.stamina - 10).toFixed(2));
            const nextBond = (newState.protege.bondLv || 1) + 1;
            newState.protege = { ...newState.protege, bondLv: nextBond };
            newState.protegeBonds = {
              ...(newState.protegeBonds || {}),
              [pId]: Math.max(nextBond, newState.protegeBonds?.[pId] || 0)
            };
            newState.careerProtegeExp = (newState.careerProtegeExp || 0) + 2;
          }
          if (newState.money >= 16000 && newState.stamina >= newState.maxStamina * 0.8) {
            newState.money -= 4000;
            newState.stamina = Number((newState.stamina - 8).toFixed(2));
            newState.relations.teamChem = (newState.relations.teamChem || 1) + 1;
            newState.careerTeamDinners = (newState.careerTeamDinners || 0) + 1;
          }
        }
        if (secLv >= 2) {
          // 自動消化も手動と同じルール（月1回・+6・上限100・結婚は100）で進める。
          // ここだけ旧ルール（+10・40で結婚）だと、秘書を買った人が
          // 一瞬で結婚してしまい、段階イベントを一つも見ないまま終わる。
          const romanceMonth = newState.age * 12 + newState.month;
          if (
            !isSocialBanned &&
            !newState.life.married &&
            newState.lastRomanceMonth !== romanceMonth &&
            newState.age >= 15 &&
            newState.money >= 5000 &&
            (newState.life.affection || 0) < AFFECTION_MAX
          ) {
            const pType = newState.life.partnerType || 'childhood';
            const pObj = PARTNER_TYPES[pType];
            const baseAff = newState.life.affection || 0;
            const newAff = Math.min(AFFECTION_MAX, baseAff + AFFECTION_PER_DATE);
            const milestone = reachedMilestone(baseAff, newAff);
            const married = newAff >= AFFECTION_MARRY && newState.age >= 18;
            const hasChild = newState.life.hasChild;

            newState.lastRomanceMonth = romanceMonth;
            newState.money -= 5000;
            newState.careerTotalAffection = (newState.careerTotalAffection || 0) + AFFECTION_PER_DATE;
            newState.careerFamilyEvents = (newState.careerFamilyEvents || 0) + (married ? 1 : 0);
            const prevRec = newState.partnerRecords?.[pType] || { maxAff: 0, married: false };
            newState.partnerRecords = {
              ...(newState.partnerRecords || {}),
              [pType]: {
                maxAff: Math.max(prevRec.maxAff, newAff),
                married: prevRec.married || married
              }
            };
            newState.life = {
              ...newState.life,
              status: married
                ? `${pObj.name}と結婚（浮気なし・一途）`
                : `${pObj.name}と交際中 (親密度${newAff}/${AFFECTION_MAX})`,
              partnerType: pType,
              affection: newAff,
              married,
              hasChild
            };
            if (milestone) {
              const writer = ROMANCE_FLAVOR[pType]?.[milestone.key];
              if (writer) {
                const text = `【${milestone.label}】\n` + writer(newState, pObj.name);
                newState.storyFlavor = text;
                addLogMsg(newState, text, 'story');
              }
              if (milestone.effect === 'charm' && !newState.unlockedCharms.includes('charm_lover')) {
                newState.unlockedCharms = [...newState.unlockedCharms, 'charm_lover'];
              }
              if (milestone.effect === 'mental') {
                newState.maxMental = Number((newState.maxMental + 10).toFixed(2));
              }
              if (milestone.effect === 'growth') {
                newState.maxStamina = Number((newState.maxStamina + 10).toFixed(2));
                newState.tactics = Number((newState.tactics + 60).toFixed(1));
              }
              if (milestone.effect === 'stamina') {
                newState.maxStamina = Number((newState.maxStamina + 15).toFixed(2));
              }
            }
          }
          if (newState.life.married && !newState.life.hasChild && newState.age >= 20 && nextRandom(newState) < 0.18) {
            newState.life = {
              ...newState.life,
              hasChild: true,
              childBornAge: newState.age,
              status: '愛する妻と第一子誕生（成長待ち）'
            };
            newState.careerFamilyEvents = (newState.careerFamilyEvents || 0) + 1;
            const babyMsg = '👶【第一子誕生】愛するパートナーとの間に元気な赤ちゃんが誕生！成長すれば自動でサッカーの道へ進むかも！？';
            newState.storyFlavor = babyMsg;
            addLogMsg(newState, babyMsg, 'levelup');
            if (!suppressToast) {
              pushToast('👶 第一子誕生！', 'この子が16歳になったら、自分からサッカーの道を選ぶ', 'pink');
            }
          }
          if (
            newState.age >= 16 &&
            newState.categoryId >= MEDIA_MIN_CAT &&
            newState.mental >= newState.maxMental * 0.75
          ) {
            newState.mental = Number((newState.mental - 12).toFixed(2));
            newState.fans += Math.round(15 + CATEGORIES[newState.categoryId].fanGain * 1.5);
            newState.money += Math.round(4500 + CATEGORIES[newState.categoryId].baseReward * 0.75);
            newState.careerMediaCount = (newState.careerMediaCount || 0) + 1;
          }
        }
      }

      // 結婚済みの場合、時間経過で自然に第一子誕生判定
      if (newState.life.married && !newState.life.hasChild && newState.age >= 20 && nextRandom(newState) < 0.16) {
        newState.life = {
          ...newState.life,
          hasChild: true,
          childBornAge: newState.age,
          status: '愛する妻と第一子誕生（成長待ち）'
        };
        newState.careerFamilyEvents = (newState.careerFamilyEvents || 0) + 1;
        const babyMsg = '👶【第一子誕生】愛するパートナーとの間に元気な赤ちゃんが誕生！成長すれば自動でサッカーの道へ進むかも！？';
        newState.storyFlavor = babyMsg;
        addLogMsg(newState, babyMsg, 'levelup');
        if (!suppressToast) {
          pushToast('👶 第一子誕生！', 'この子が16歳になったら、自分からサッカーの道を選ぶ', 'pink');
        }
      }

      // 4月進級・進路選択（7歳ジュニア3択・12歳中学4択・15歳高校・18歳卒業後・22歳卒業）
      if (newState.month === 4) {
        const rating = getTotalRating(newState);
        const isFirstRun = newState.generation === 1 && (newState.ascensionCount || 0) === 0;
        const isJ1Challenge =
          newState.activeChallenge === 'ch_no_gear' ||
          newState.activeChallenge === 'ch_twilight_32' ||
          newState.activeChallenge === 'ch_ascetic_god';

        const resolveCareerOptions = (ageKey, heading, sub, opts) => {
          const allGenomesMastered = opts.every((o) => (newState.genomes?.[o.genomeId] || 0) >= 5);
          if (allGenomesMastered && newState.qolToggles?.autoCareerPath) {
            const bestOpt = [...opts].reverse().find((o) => o.unlocked) || opts[0];
            newState.careerPath = bestOpt.id;
            newState.careerPathLabel = bestOpt.shortTitle;
            newState.clubName = bestOpt.clubTitle || bestOpt.shortTitle;
            newState.categoryId = Math.max(newState.categoryId, bestOpt.setCategoryId ?? newState.categoryId);
            newState.money += bestOpt.bonusMoney || 0;
            if (bestOpt.achievementId && !newState.achievements.includes(bestOpt.achievementId)) {
              newState.achievements = [...newState.achievements, bestOpt.achievementId];
            }
            const autoMsg = `🤖【自動進路決定】全進路ゲノム極意完了済みのため、最上位進路「${bestOpt.title}」へ自動進学！`;
            newState.storyFlavor = autoMsg;
            addLogMsg(newState, autoMsg, 'story');
            return null;
          }
          if (!suppressModals) {
            return {
              type: 'career',
              modal: { age: ageKey, heading, sub, options: opts }
            };
          }
          return null;
        };

        if (newState.age === 7 && !newState.triggeredEvents.includes('age7')) {
          newState.triggeredEvents = [...newState.triggeredEvents, 'age7'];
          const opts7 = [
            {
              id: 'jr_local',
              shortTitle: '地元ジュニア少年団',
              clubTitle: '蒼空FCジュニア',
              title: '地元ジュニア少年団へ入団（普通の弱小チーム）',
              unlocked: true,
              reqText: '条件なし（誰でも入団可能）',
              perkSummary: '体力回復+4%/Lv・仲間と楽しくボールを蹴る原点',
              genomeId: 'jr_local_dna',
              genomeName: '街のサッカー小僧遺伝子',
              setCategoryId: 1
            },
            {
              id: 'jr_elite',
              shortTitle: 'エリートジュニア',
              clubTitle: '蒼空エリートジュニアスクール',
              title: '地域選抜エリートジュニアコース',
              unlocked: !isFirstRun && rating >= 9,
              reqText: isFirstRun ? '第1周目は選抜落選（2周目以降・総合力9以上）' : '必要条件: 総合力 9 以上',
              perkSummary: '技術成長+4%/Lv・早期から質の高い基礎技術を習得',
              genomeId: 'jr_elite_dna',
              genomeName: '早期英才教育遺伝子',
              setCategoryId: 1
            },
            {
              id: 'jr_abroad',
              shortTitle: '幼少期海外留学',
              clubTitle: 'イベリア・キッズカンテラ',
              title: '幼少期の海外キッズ留学',
              unlocked: !isFirstRun && rating >= 16 && newState.money >= 25000,
              reqText: isFirstRun ? '第1周目は不可（2周目以降・総合16 & 2.5万円）' : '必要条件: 総合力 16 & 資金 2.5万円',
              perkSummary: '全成長+3.5%/Lv・小学生から世界のカンテラで揉まれる',
              genomeId: 'jr_abroad_dna',
              genomeName: '幼少期海外カンテラ遺伝子',
              setCategoryId: 2
            }
          ];
          const res7 = resolveCareerOptions(
            7,
            '7歳・小学校入学＆ジュニアチーム選択',
            `現在の総合力: ${formatNum(rating, 1)}（未コンプ進路がある場合は手動選択）`,
            opts7
          );
          if (res7) return res7;
        } else if (newState.age === 12 && !newState.triggeredEvents.includes('age12')) {
          newState.triggeredEvents = [...newState.triggeredEvents, 'age12'];
          const opts12 = [
            {
              id: 'local_jhs',
              shortTitle: '地元弱小中学部',
              clubTitle: '蒼空市立第一中学サッカー部',
              title: '地元公立中学校サッカー部（普通の弱小部活）',
              unlocked: true,
              reqText: '条件なし（1周目はここからスタート）',
              perkSummary: '格上戦力+4%/Lv・出場機会が豊富で雑草魂が育つ',
              genomeId: 'grassroots_dna',
              genomeName: '雑草魂の遺伝子',
              setCategoryId: 2
            },
            {
              id: 'regional_jhs',
              shortTitle: '地域強豪クラブ',
              clubTitle: '蒼空ユナイテッドJY（強豪）',
              title: '地域強豪ジュニアユースクラブ',
              unlocked: !isFirstRun && rating >= 15,
              reqText: isFirstRun ? '第1周目は入団テスト落選（総合力15以上）' : '必要条件: 総合力 15 以上',
              perkSummary: '身体・決定成長+3.5%/Lv・激しいレギュラー争いで鍛える',
              genomeId: 'regional_jhs_dna',
              genomeName: '地域強豪クラブ遺伝子',
              setCategoryId: 2
            },
            {
              id: 'j_jy',
              shortTitle: 'J下部JY',
              clubTitle: '蒼空FCジュニアユース',
              title: 'Jクラブ下部ジュニアユース合格',
              unlocked: !isFirstRun && rating >= 22,
              reqText: isFirstRun ? '第1周目は選考落選（総合力22以上）' : '必要条件: 総合力 22 以上',
              perkSummary: '技術・戦術成長+3.5%/Lv・プロ予備軍のエリート指導',
              genomeId: 'j_elite_dna',
              genomeName: 'J下部JYエリート遺伝子',
              achievementId: 'jy_pass',
              setCategoryId: 3
            },
            {
              id: 'brazil_ryugaku',
              shortTitle: '海外ジュニア留学',
              clubTitle: 'サンパウロ育成FC',
              title: '海外ジュニアサッカー留学（南米・欧州）',
              unlocked: !isFirstRun && rating >= 30 && newState.money >= 50000,
              reqText: isFirstRun ? '第1周目は不可（総合30 & 資金5万円）' : '必要条件: 総合力 30 & 資金 5万円',
              perkSummary: '技術成長+4%/Lv・ストリートサッカーの閃きを体得',
              genomeId: 'brazil_ginga_dna',
              genomeName: '海外ジュニア留学ジンガ遺伝子',
              setCategoryId: 3
            }
          ];
          if ((newState.ascensionCount || 0) >= 1) {
            opts12.push({
              id: 'world_acad_12',
              shortTitle: '世界アカデミー',
              clubTitle: 'ワールド・ワンダーキッズ学院',
              title: '【第2転生解禁】世界エリート神童アカデミー',
              unlocked: true,
              reqText: '上位転生特典（能力ハードルなし・即入団可）',
              perkSummary: '全成長+3%/Lv & 上限上昇・世界最高峰の早熟英才教育',
              genomeId: 'world_acad_12_dna',
              genomeName: '世界神童アカデミー遺伝子',
              setCategoryId: 5
            });
          }
          const res12 = resolveCareerOptions(
            12,
            '12歳・中学年代の進路選択（Lv.5でアーカイブ移行後も微成長継続）',
            `現在の総合力: ${formatNum(rating, 1)}`,
            opts12
          );
          if (res12) return res12;
        } else if (newState.age === 15 && !newState.triggeredEvents.includes('age15')) {
          newState.triggeredEvents = [...newState.triggeredEvents, 'age15'];
          const opts15 = [
            {
              id: 'underdog_hs',
              shortTitle: '地元公立弱小高校',
              clubTitle: '県立蒼空高校サッカー部',
              title: '地元公立弱小高校サッカー部（初戦敗退常連校）',
              unlocked: true,
              reqText: '条件なし（1周目は公立校の補欠〜レギュラーへ）',
              perkSummary: 'カップ優勝で全能力上限が伸びる三冠遺伝子が覚醒',
              genomeId: 'underdog_hero_dna',
              genomeName: '公立弱小校の三冠遺伝子',
              setCategoryId: 4
            },
            {
              id: 'elite_youth',
              shortTitle: '名門Jユース',
              clubTitle: '蒼空FCユース（U-18）',
              title: '名門Jクラブユース・全国強豪校',
              unlocked: !isFirstRun && rating >= 40,
              reqText: isFirstRun ? '第1周目はセレクション落選（総合力40以上）' : '必要条件: 総合力 40 以上',
              perkSummary: '全戦力+3%/Lv・最高峰の育成環境でプロ入りを目指す',
              genomeId: 'famous_youth_dna',
              genomeName: '名門王者の遺伝子',
              achievementId: 'youth_elite',
              setCategoryId: 5
            },
            {
              id: 'overseas_acad',
              shortTitle: '海外アカデミー',
              clubTitle: '欧州・南米留学アカデミー',
              title: '欧州・南米アカデミー単身留学',
              unlocked: !isFirstRun && rating >= 60 && newState.money >= 120000,
              reqText: isFirstRun ? '第1周目は不可（総合60 & 資金12万円）' : '必要条件: 総合力 60 & 資金 12万円',
              perkSummary: '決・身成長+3.5%/Lv・若くして世界の強度を体感',
              genomeId: 'overseas_wild_dna',
              genomeName: '越境者の野性遺伝子',
              setCategoryId: 5
            }
          ];
          if ((newState.totalGenerations || newState.generation) >= 3 || (newState.ascensionCount || 0) >= 1) {
            opts15.push({
              id: 'spain_cantera',
              shortTitle: 'スペイン留学',
              clubTitle: 'イベリア・ラ・カンテラ',
              title: '【3周目解禁】スペイン名門カンテラ留学',
              unlocked: rating >= 95 && newState.money >= 250000,
              reqText: '必要条件: 総合力 95 & 資金 25万円',
              perkSummary: '戦・技成長+4%/Lv・世界最高峰のポジショナルプレーを習得',
              genomeId: 'spain_cantera_dna',
              genomeName: 'ティキ・タカの遺伝子',
              setCategoryId: 5
            });
          }
          if ((newState.ascensionCount || 0) >= 1) {
            opts15.push({
              id: 'galaxy_cantera_15',
              shortTitle: '銀河系カンテラ',
              clubTitle: 'ギャラクシーU-18特別カンテラ',
              title: '【第2転生解禁】銀河系ユースカンテラ特別生',
              unlocked: true,
              reqText: '上位転生特典（能力ハードルなし・即入団可）',
              perkSummary: '全戦力+3%/Lv & 上限上昇・異次元のユース黄金世代',
              genomeId: 'galaxy_cantera_15_dna',
              genomeName: '銀河系カンテラ遺伝子',
              setCategoryId: 8
            });
          }
          const res15 = resolveCareerOptions(
            15,
            '15歳・高校年代の進路選択（Lv.5でアーカイブ移行後も微成長継続）',
            `現在の総合力: ${formatNum(rating, 1)} / 資金: ${formatYen(newState.money)}`,
            opts15
          );
          if (res15) return res15;
        } else if (newState.age === 18 && !newState.triggeredEvents.includes('age18')) {
          newState.triggeredEvents = [...newState.triggeredEvents, 'age18'];
          const bonusG = Math.round(12000 + rating * 350);
          const alreadyPro = newState.categoryId >= 9;

          const opts18 = [
            {
              id: 'uni_club',
              shortTitle: '大学サッカー部',
              clubTitle: '東都体育大学蹴球部',
              title: '大学サッカー部へ進学（知性派ゲノム育成・高能力でも選択可）',
              unlocked: true,
              reqText: '条件なし（戦術眼と知性派遺伝子を極める進路）',
              perkSummary: '戦術成長+3.5%/Lv・勝敗と戦術練習で「大卒知性派遺伝子」が確実に育つ',
              genomeId: 'university_iq_dna',
              genomeName: '大卒知性派の遺伝子',
              bonusMoney: bonusG,
              setCategoryId: alreadyPro ? newState.categoryId : 6
            },
            {
              id: 'jfl_path',
              shortTitle: 'JFL・社会人挑戦',
              clubTitle: '蒼空FC（JFL/社会人トップ）',
              title: '社会人・JFLクラブ入団（ハングリー挑戦）',
              unlocked: !isFirstRun && rating >= 65,
              reqText: isFirstRun ? '第1周目は入団テスト落選（総合力65以上）' : '必要条件: 総合力 65 以上',
              perkSummary: '身・決成長+3.5%/Lv・実戦の泥臭い勝負で這い上がる',
              genomeId: 'jfl_hungry_dna',
              genomeName: 'ハングリー精神の遺伝子',
              bonusMoney: bonusG,
              setCategoryId: alreadyPro ? newState.categoryId : 7
            },
            {
              id: 'pro_direct',
              shortTitle: 'Jリーグプロ契約',
              clubTitle: '蒼空FC（Jリーグプロ）',
              title: alreadyPro ? 'Jリーグ・プロキャリア本格飛躍！' : 'J3〜J2クラブと念願のプロ契約締結！',
              unlocked: !isFirstRun && (alreadyPro || rating >= 165),
              reqText: isFirstRun ? '第1周目はプロ全滅（総合力165以上）' : '必要条件: 総合力 165 以上',
              perkSummary: '20歳まで若手成長+5%/Lv＆プロ賞金獲得',
              genomeId: 'young_pro_dna',
              genomeName: '若きプロフェッショナル遺伝子',
              achievementId: 'j_leaguer',
              bonusMoney: Math.round(bonusG * 1.5),
              setCategoryId: alreadyPro ? newState.categoryId : 9
            }
          ];

          if (!isJ1Challenge) {
            if ((newState.totalGenerations || newState.generation) >= 4 || (newState.ascensionCount || 0) >= 1) {
              opts18.push({
                id: 'euro_trial',
                shortTitle: '欧州2部単身挑戦',
                clubTitle: '欧州2部チャレンジャーFC',
                title: '【4周目解禁】欧州2部クラブ単身トライアウト挑戦',
                unlocked: rating >= 220 && newState.money >= 450000,
                reqText: '必要条件: 総合力 220 & 資金 45万円',
                perkSummary: '全戦力+3%/Lv・18歳から欧州の過酷な競争へ飛び込む',
                genomeId: 'euro_survival_dna',
                genomeName: '欧州サバイバル遺伝子',
                bonusMoney: bonusG * 2,
                setCategoryId: 10
              });
            }
            if ((newState.ascensionCount || 0) >= 1) {
              opts18.push({
                id: 'euro_top_18',
                shortTitle: '欧州メガ即戦力',
                clubTitle: '欧州1部メガクラブ',
                title: '【第2転生解禁】欧州メガクラブ即戦力プロ契約',
                unlocked: true,
                reqText: '上位転生特典（能力ハードルなし・即契約可）',
                perkSummary: '賞金+5%/Lv & 上限上昇・18歳から欧州トップリーグ主力へ',
                genomeId: 'euro_top_18_dna',
                genomeName: '欧州メガクラブ即戦力遺伝子',
                bonusMoney: bonusG * 4,
                setCategoryId: 12
              });
            }
          }

          const res18 = resolveCareerOptions(
            18,
            '18歳・高校卒業後のキャリア選択',
            `現在の総合力: ${formatNum(rating, 1)}（祝儀 +${formatYen(bonusG)}）`,
            opts18
          );
          if (res18) return res18;
        } else if (
          newState.age === 22 &&
          newState.careerPath === 'uni_club' &&
          !newState.triggeredEvents.includes('grad22')
        ) {
          newState.triggeredEvents = [...newState.triggeredEvents, 'grad22'];
          if (newState.generation === 1 && (newState.ascensionCount || 0) === 0) {
            newState.isRetired = true;
            newState.unlocks.reincarnateTab = true;
            checkGenomeAwakening(newState);
            addLogMsg(
              newState,
              '【22歳4月・運命の夜】大学卒業後のプロテストにすべて落ち、雨の夜道で暴走トラックに跳ねられた――意識が5歳の春へ巻き戻る！',
              'story'
            );
            return {
              type: 'truck',
              modal: {
                heading: '💥 22歳4月・プロ全滅からの強制タイムリープ（第1周目完結）',
                paragraphs: [
                  `弱小校から大学サッカー部まで這い上がった「${newState.playerName}」だったが、Jクラブの入団テストはすべて不合格に終わった。`,
                  '雨の夜道、信号無視のトラックのヘッドライトが視界を白く染め――次の瞬間、懐かしい小学校のチャイムが耳に響く。',
                  '「…えっ、5歳に戻ってる！？ 記憶も知識も残ったままだ…！ 今度こそ絶対にプロの頂点へ行く！」'
                ]
              }
            };
          } else {
            newState.careerPath = 'jfl_path';
            newState.careerPathLabel = '大卒・社会人/プロ挑戦';
            if (newState.categoryId < 7) {
              newState.categoryId = 7;
              newState.clubName = CATEGORIES[7].clubDefault;
            }
            addLogMsg(
              newState,
              '🎓【22歳4月・大学卒業】大学サッカー部を卒業し、社会人・Jリーグの舞台へ羽ばたいた！',
              'story'
            );
          }
        }
      }

      // 30歳以降の衰え。
      //
      // 以前は「絶対値」で削っていたため（40歳で年2.9ポイント）、
      // 能力が1000あっても年0.3%しか落ちず、60歳で銀河系リーグに
      // 居座れてしまった。本人指摘「60歳とかで欧州銀河系とかはさすがにあり得ない」。
      //
      // 割合で削る形に変え、年齢の2乗で加速させる。
      //   30歳 年3% / 35歳 年25% / 40歳 年60% / 45歳 年86% / 50歳 年97%
      // 長く現役を続けたいなら、衰え緩和（ED5・CH5・ゲノム・隠しゲノム）を
      // 積む必要がある、という設計にする。
      if (newState.age >= 30) {
        if (newState.age >= 35) {
          newState.careerVeteranMonths = (newState.careerVeteranMonths || 0) + 1;
        }
        const decayYears = newState.age - 29;
        const secretCut = newState.secretGenomes?.includes('secret_veteran_iron') ? 0.5 : 1.0;
        const kingCut = Math.max(0.25, 1 - (g.king_eternal_dna || 0) * 0.1);
        const fusedKingCut = fused.includes('fused_eternal_king') ? 0.35 : 1.0;
        const ed5Cut = newState.unlockedEndings?.includes('ed_eternal_50') ? 0.7 : 1.0;
        const ch5Cut = newState.completedChallenges?.includes('ch_twilight_32') ? 0.55 : 1.0;
        const totalDecayMult = secretCut * kingCut * fusedKingCut * ed5Cut * ch5Cut;

        // 月あたりの減少率。年齢の2乗で効くので、歳を取るほど一気に落ちる
        const monthlyRate = Math.min(0.5, (0.002 + decayYears * decayYears * 0.0006) * totalDecayMult);
        // 落ちる先は「その年齢の上限」まで。
        // 上限（computeIndividualStatCaps の ageCapMult）が歳とともに落ちるので、
        // ここは上限へ収束させる役。上限より下では削らない
        // ＝「衰えたぶんは練習で維持できるが、器を超えては戻せない」形にする。
        const shrink = (v, mult, capV) =>
          Number(
            Math.max(Math.min(v, capV), Math.max(1.0, v * (1 - monthlyRate * mult))).toFixed(3)
          );
        const capOf = (key) => newState.statCaps?.[key] || 1;
        newState.stats.phy = shrink(newState.stats.phy, 1.0, capOf('phy'));
        newState.stats.tec = shrink(newState.stats.tec, 0.42, capOf('tec'));
        newState.stats.sht = shrink(newState.stats.sht, 0.42, capOf('sht'));
        // 戦術眼は経験なので落ちにくいが、まったく落ちないわけでもない
        newState.stats.iq = shrink(newState.stats.iq, 0.18, capOf('iq'));
        newState.maxStamina = Number(Math.max(15, newState.maxStamina - 0.18 * totalDecayMult).toFixed(2));
        if (newState.stamina > newState.maxStamina) {
          newState.stamina = newState.maxStamina;
        }
      }

      // 宿敵ティア更新
      let targetTier = 0;
      for (const rt of RIVAL_TIERS) {
        if (newState.categoryId >= rt.minCat) targetTier = rt.tier;
      }
      if ((newState.rival?.tierIdx || 0) < targetTier) {
        const nextRt = RIVAL_TIERS[targetTier];
        newState.rival = {
          tierIdx: targetTier,
          rating: nextRt.baseRating,
          winsAgainst: 0
        };
        const rMsg = `⚔️【新たな宿敵出現】${nextRt.alias}「${nextRt.name}」が立ちはだかる！${nextRt.quote}`;
        newState.storyFlavor = rMsg;
        addLogMsg(newState, rMsg, 'story');
        if (!suppressToast) {
          pushToast(`⚔️ 新宿敵：${nextRt.name}`, nextRt.alias, 'rose');
        }
      }

      // ランダム人生イベント
      triggerRandomLifeEvent(newState);

      // AUTO練習実行
      if (newState.unlocks.autoFeature && newState.autoActions.length > 0) {
        const isBtBanned = newState.activeChallenge === 'ch_no_memory' || newState.activeChallenge === 'ch_ascetic_god';
        if (!isBtBanned && (newState.legacyUpgrades?.auto_drill_switcher || 0) >= 1) {
          newState.autoActions = computeOptimalAutoList(newState);
        }
        const schedLv = isGearBanned ? 0 : newState.upgrades?.ai_schedule || 0;
        const memLv = newState.legacyUpgrades?.tactical_memory || 0;
        const smartBonus = !isBtBanned && newState.breakthroughs?.smart_auto_all ? 1 : 0;
        const divineOverdrive = newState.ascensionUpgrades?.divine_auto_overdrive || 0;
        const autoLoops = 1 + schedLv + memLv + smartBonus + divineOverdrive;

        for (let loop = 0; loop < autoLoops; loop++) {
          for (const actId of newState.autoActions) {
            if (!isBtBanned && newState.breakthroughs?.smart_auto_all) {
              const dObj = DRILLS_DEF.find((d) => d.id === actId);
              if (dObj) {
                const isPrimaryMax = (newState.stats[dObj.primaryStat] || 0) >= (newState.statCaps[dObj.primaryStat] || 10);
                const isSecondaryMax = dObj.secondaryStat
                  ? (newState.stats[dObj.secondaryStat] || 0) >= (newState.statCaps[dObj.secondaryStat] || 10)
                  : true;
                const anyUncapped = DRILLS_DEF.some(
                  (d) =>
                    newState.unlocks[d.id] &&
                    ((newState.stats[d.primaryStat] || 0) < (newState.statCaps[d.primaryStat] || 10) ||
                      (d.secondaryStat &&
                        (newState.stats[d.secondaryStat] || 0) < (newState.statCaps[d.secondaryStat] || 10)))
                );
                if (isPrimaryMax && isSecondaryMax && anyUncapped) continue;
              }
            }
            executeDrillInternal(newState, actId, suppressToast);
          }
        }
      }

      // 公式戦判定
      const isBtBanned = newState.activeChallenge === 'ch_no_memory' || newState.activeChallenge === 'ch_ascetic_god';
      const matchInterval = !isBtBanned && newState.breakthroughs?.dense_schedule ? 1 : 2;
      if (newState.matchCounter >= matchInterval) {
        newState.matchCounter = 0;
        const isCup = newState.month === 6 || newState.month === 12;
        simulateAutoMatch(newState, isCup, suppressToast);
      }

      // 限界年齢到達 または 衰えによる戦力限界による現役引退
      const postDecayRating = getTotalRating(newState);
      // 引退は「年齢」ではなく「どこも契約してくれなくなったとき」。
      // 衰えて降格を続け、最下層でも通用しなくなったら現役生活が終わる。
      // docs/GAME_DESIGN.md §18
      //
      // ただし「最下層まで落ちるのを待つ」だけだと、実測で引退しなかった。
      // 衰えても戦術眼（iq）は落ちにくいので総合力が 6 前後で下げ止まり、
      // 地域ジュニアの要求（6.5×0.72=4.68）を割らずに 71歳まで現役が続いた。
      //
      // 現実のほうが近い: 最下層に落ちるより前に、
      // 「ピーク時の何割まで落ちたか」でオファーが来なくなる。
      // 33歳以降、ピークの4割を切ったらどこも契約しない。
      // 衰え緩和を積めば低下そのものが遅くなるので、その人は長く現役でいられる。
      const careerPeak = Math.max(newState.peakRatingReached || 0, postDecayRating);
      const declineRatio = careerPeak > 0 ? postDecayRating / careerPeak : 1;
      const noContract =
        newState.age >= 24 &&
        ((newState.categoryId === 0 && postDecayRating < CONTRACT_FLOOR_RATING) ||
          (newState.age >= 33 && declineRatio < 0.4));
      // 肉体の限界。
      //
      // 「ピークの4割」だけだと、弱いキャリアほど引退しない。
      // ピークが 7 なら 2.8 を割るまで契約が続いてしまい、実測で64歳まで
      // 地域ジュニアに居座った。低いピークは低下率も小さいので当然である。
      //
      // maxRetireAge（＝鉄人の肉体遺伝子などで伸びる現役寿命）に 12年の
      // 猶予を足したところを限界にする。素なら 28+12=40歳、
      // 鉄人をMAXまで積めば 58+12=70歳。寿命強化に意味が出る形にする。
      const hardAgeLimit = newState.age >= Math.max(40, (newState.maxRetireAge || 28) + 12);

      if ((noContract || hardAgeLimit) && !newState.isRetired) {
        newState.isRetired = true;
        newState.unlocks.reincarnateTab = true;
        checkGenomeAwakening(newState);
        const genNum = newState.totalGenerations || newState.generation;
        const finalCatName = CATEGORIES[newState.categoryId].name;
        const retireReason = noContract
          ? `どのクラブからも契約の話が来なくなり（ピーク総合${formatNum(newState.peakRatingReached, 1)}→${formatNum(postDecayRating, 1)}）`
          : `肉体の限界（${newState.age}歳）を迎え`;
        addLogMsg(
          newState,
          `【現役引退・輪廻の刻】${newState.age}歳で${retireReason}現役を引退。再び5歳の春へ意識が引き戻されていく――！`,
          'story'
        );

        // 周回数に応じて語りが変わる（src/data/flavorText.js）。
        // 同じ文章を何十回も読ませないためでもあるが、
        // 「何度もやり直している人間がどう変質していくか」そのものが物語になる。
        let storyParas;
        try {
          storyParas = timeLeapFlavor(newState, calculateLegacyGain(newState)).split('\n');
        } catch {
          storyParas = [
            `第${genNum}周目のキャリアを全うした「${newState.playerName}」（最終所属: ${finalCatName} / ピーク総合力 ${formatNum(newState.peakRatingReached, 1)}）。`,
            `${newState.age}歳で${retireReason}スパイクを置き、数多のプレースタイルと知識・記憶を次の輪廻へ託す。`
          ];
        }

        return {
          type: 'truck',
          modal: {
            heading: `⏳ ${newState.age}歳・現役引退とタイムリープの刻（第${genNum}周目完結）`,
            paragraphs: storyParas
          }
        };
      }

      checkGenomeAwakening(newState);
      return null;
    },
    [executeDrillInternal, simulateAutoMatch, checkGenomeAwakening, triggerRandomLifeEvent, pushToast]
  );

  // --- メインゲームループ（2x / 4x / 8x対応） ---
  useEffect(() => {
    if (
      isPaused ||
      gameState.isRetired ||
      careerChoiceModal ||
      truckEventModal ||
      creatorModal.open ||
      tutorialModalOpen
    ) {
      return;
    }

    const tickMs = Math.max(125, Math.floor(1000 / gameSpeed));
    const timer = setInterval(() => {
      setGameState((prev) => {
        if (prev.isRetired) return prev;
        // 新機能の解放モーダルを読んでいる間も止める
        if (prev.pendingUnlocks) return prev;
        // エンディングの本文を読んでいる間も止める
        if (prev.pendingEnding) return prev;
        // モーダル待ちの間は時間を進めない。
        // 依存配列（careerChoiceModal 等）だけに頼ると、モーダルを開く
        // useEffect が走るまでの1ティック分で次の月が進み、せっかく積んだ
        // pendingModal が上書きで消えることがある。
        if (prev.pendingModal) return prev;
        const next = cloneStateForTick(prev);
        // advanceOneMonth の戻り値（進路選択・タイムリープ）は state に載せて運ぶ。
        // setGameState の updater は非同期に実行されるため、外側のローカル変数へ
        // 書いて直後に読む形では常に null になり、モーダルが永久に捨てられる。
        // 返ってきたときだけ積む。null で上書きしない。
        const requested = advanceOneMonth(next);
        if (requested) next.pendingModal = requested;
        return next;
      });
    }, tickMs);

    return () => clearInterval(timer);
  }, [
    isPaused,
    gameSpeed,
    gameState.isRetired,
    careerChoiceModal,
    truckEventModal,
    creatorModal.open,
    tutorialModalOpen,
    advanceOneMonth
  ]);

  // --- 手動練習クリック ---
  const handleDrillClick = (drillId) => {
    setGameState((prev) => {
      if (prev.isRetired) return prev;
      const next = {
        ...prev,
        stats: { ...prev.stats },
        mastery: { ...prev.mastery },
        unlocks: { ...prev.unlocks },
        tacticalMastery: { ...prev.tacticalMastery },
        careerDrillCounts: { ...prev.careerDrillCounts }
      };
      const ok = executeDrillInternal(next, drillId, false);
      if (!ok) return prev;
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- AUTOトグル ---
  const toggleAutoDrill = (drillId) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_pure_body' && (drillId === 'tactics_video' || drillId === 'mental_image')) {
        return prev;
      }
      const exists = prev.autoActions.includes(drillId);
      if (exists) {
        return { ...prev, autoActions: prev.autoActions.filter((id) => id !== drillId) };
      }
      if (prev.autoActions.length >= prev.maxAutoSlots) {
        return { ...prev, autoActions: [...prev.autoActions.slice(1), drillId] };
      }
      return { ...prev, autoActions: [...prev.autoActions, drillId] };
    });
  };

  // --- 道具・自己投資アップグレード購入（1x / 10x / MAX統一） ---
  const buyUpgrade = (upg) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_no_gear' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      const curLv = prev.upgrades?.[upg.id] || 0;
      const maxLv = upg.maxLv || 99;
      if (curLv >= maxLv) return prev;

      const calc = calcBulkPurchase(
        curLv,
        maxLv,
        buyAmount,
        prev.money,
        prev.tactics,
        upg.baseG,
        upg.basePt,
        upg.growth
      );
      if (calc.count === 0) return prev;

      const nextUpgrades = { ...prev.upgrades, [upg.id]: calc.nextLv };
      const memLv = prev.legacyUpgrades?.tactical_memory || 0;
      const schedLv = nextUpgrades.ai_schedule || 0;
      const nextMaxAuto = prev.breakthroughs?.smart_auto_all
        ? 5
        : Math.min(5, 1 + memLv + Math.min(4, schedLv));

      let nextAutoActions = [...prev.autoActions];
      if (upg.id === 'ai_schedule' && prev.unlocks.autoFeature) {
        for (const id of ALL_DRILL_IDS) {
          if (prev.unlocks[id] && !nextAutoActions.includes(id) && nextAutoActions.length < nextMaxAuto) {
            nextAutoActions.push(id);
          }
        }
      }

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        upgrades: nextUpgrades,
        maxAutoSlots: nextMaxAuto,
        autoActions: nextAutoActions,
        maxStamina: upg.id === 'agility_gear' ? prev.maxStamina + 4 * calc.count : prev.maxStamina
      };
      addLogMsg(next, `🛒【道具強化】「${upg.name}」Lv.${calc.nextLv}（+${calc.count}Lv）`, 'info');
      return next;
    });
  };

  // --- 永続ブレイクスルー購入 ---
  const buyBreakthrough = (bt) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_no_memory' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      if (prev.breakthroughs?.[bt.id]) return prev;
      if (prev.money < bt.costMoney || prev.tactics < bt.costTactics) return prev;

      const nextBt = { ...(prev.breakthroughs || {}), [bt.id]: true };
      const nextUnlocks = { ...prev.unlocks };
      let nextAuto = [...prev.autoActions];
      let nextMaxAuto = prev.maxAutoSlots;

      if (bt.id === 'smart_auto_all') {
        nextUnlocks.autoFeature = true;
        nextMaxAuto = 5;
        nextAuto = ALL_DRILL_IDS.filter((id) => nextUnlocks[id]);
      }

      const next = {
        ...prev,
        money: prev.money - bt.costMoney,
        tactics: Number((prev.tactics - bt.costTactics).toFixed(1)),
        breakthroughs: nextBt,
        unlocks: nextUnlocks,
        autoActions: nextAuto,
        maxAutoSlots: nextMaxAuto,
        maxTraitSlots: computeMaxTraitSlots(
          prev.ascensionCount || 0,
          prev.ascensionUpgrades,
          prev.legacyUpgrades,
          nextBt
        )
      };
      addLogMsg(next, `⚡【永続ブレイクスルー解放】「${bt.name}」を習得！（一次転生後も永続保持）`, 'levelup');
      pushToast(`⚡ ブレイクスルー解放！`, `${bt.name}：${bt.short}`, 'amber');
      return next;
    });
  };

  // --- 趣味アップグレード購入（1x / 10x / MAX統一・記憶永続） ---
  const buyHobby = (hb) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_lone_wolf' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      const curLv = prev.hobbies?.[hb.id] || 0;
      const maxLv = hb.maxLv || 5;
      if (curLv >= maxLv) return prev;

      const calc = calcBulkPurchase(
        curLv,
        maxLv,
        buyAmount,
        prev.money,
        prev.tactics,
        hb.baseG,
        hb.basePt,
        hb.growth
      );
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        hobbies: { ...(prev.hobbies || {}), [hb.id]: calc.nextLv },
        careerHobbyTotalLv: (prev.careerHobbyTotalLv || 0) + calc.count,
        maxStamina: hb.id === 'cooking' ? prev.maxStamina + 8 * calc.count : prev.maxStamina,
        maxMental: hb.id === 'golf' ? prev.maxMental + 6 * calc.count : prev.maxMental
      };
      addLogMsg(next, `🎨【趣味知識習得】「${hb.name}」Lv.${calc.nextLv}（タイムリープ後も永続継承）`, 'story');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 未来予知・競馬＆投資記憶アップグレード（1x / 10x / MAX統一・記憶永続） ---
  const upgradeProphecyMemory = () => {
    setGameState((prev) => {
      const curLv = prev.prophecyLv || 0;
      const maxLv = 20;
      if (curLv >= maxLv) return prev;
      const calc = calcBulkPurchase(curLv, maxLv, buyAmount, prev.money, prev.tactics, 22000, 120, 1.82);
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        prophecyLv: calc.nextLv
      };
      addLogMsg(next, `🐎【未来予知記憶】競馬・投資記憶 Lv.${calc.nextLv}（毎月副収入＆大穴イベント強化）`, 'levelup');
      pushToast(`🐎 未来予知記憶 Lv.${calc.nextLv}`, 'タイムリープ記憶の予知投資が永続強化されました！', 'amber');
      return next;
    });
  };

  // --- ファン還元アクション（スクール巡業も1x / 10x / MAX一括対応！） ---
  const executeFanSchoolTour = () => {
    setGameState((prev) => {
      const costFans = 400;
      const costG = 15000;
      const maxAffordable = Math.min(Math.floor((prev.fans || 0) / costFans), Math.floor(prev.money / costG));
      const count = buyAmount === 'max' ? maxAffordable : Math.min(buyAmount, maxAffordable);
      if (count <= 0) return prev;

      const nextMastery = { ...prev.mastery };
      for (const id of ALL_DRILL_IDS) {
        nextMastery[id] = (nextMastery[id] || 0) + 15 * count;
      }
      const next = {
        ...prev,
        fans: (prev.fans || 0) - costFans * count,
        money: prev.money - costG * count,
        tactics: Number((prev.tactics + 45 * count).toFixed(1)),
        mastery: nextMastery,
        storyFlavor: `🎪【全国スクール巡業 ×${count}回】子供たちに技術を教えることで、自身の基礎と習慣熟練度も研ぎ澄まされた！`,
        brandProjects: {
          ...prev.brandProjects,
          school_tour: (prev.brandProjects?.school_tour || 0) + count
        }
      };
      addLogMsg(next, `🎪【全国サッカースクール巡業】${count}回開催し全練習の習慣熟練度が+${15 * count}上昇！`, 'story');
      pushToast(`🎪 スクール巡業 ×${count}回！`, `全5練習の習慣熟練度 +${15 * count} ＆ 戦術Pt +${45 * count}！`, 'emerald');
      return next;
    });
  };

  const buySignatureBrand = () => {
    setGameState((prev) => {
      const curLv = prev.brandProjects?.sig_brand || 0;
      const maxLv = 30;
      if (curLv >= maxLv) return prev;
      const calc = calcBulkPurchase(curLv, maxLv, buyAmount, prev.fans || 0, prev.money, 1500, 35000, 1.65);
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        fans: (prev.fans || 0) - calc.totalG,
        money: prev.money - calc.totalPt,
        storyFlavor: `👟【シグネチャーブランド Lv.${calc.nextLv}】${prev.playerName}モデルのスパイク＆ウェアが世界中で売れ、毎月ロイヤリティが入ってくる！`,
        brandProjects: {
          ...prev.brandProjects,
          sig_brand: calc.nextLv
        }
      };
      addLogMsg(next, `👟【シグネチャーブランド】Lv.${calc.nextLv}へ拡大！（+${calc.count}Lv）`, 'levelup');
      pushToast(`👟 ブランド Lv.${calc.nextLv}`, `毎月不労収入 +${formatYen(calc.nextLv * 8500)} ＆ ファン自然増！`, 'amber');
      return next;
    });
  };

  // --- 青空FC同僚・施設・クラブ昇格運営（1x / 10x / MAX統一） ---
  const investClubMate = (mate) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_solo_carry' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      const curLv = prev.clubMates?.[mate.id] || 1;
      if (curLv >= mate.maxLv) return prev;

      const calc = calcBulkPurchase(
        curLv,
        mate.maxLv,
        buyAmount,
        prev.money,
        prev.tactics,
        mate.baseG,
        mate.basePt,
        mate.growth
      );
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        clubMates: { ...(prev.clubMates || {}), [mate.id]: calc.nextLv }
      };
      addLogMsg(next, `🏟️【蒼空FC同僚強化】${mate.name}[${mate.pos}] Lv.${calc.nextLv}へ成長！（+${calc.count}Lv）`, 'info');
      checkGenomeAwakening(next);
      return next;
    });
  };

  const investClubFacility = (fac) => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_solo_carry' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      const curLv = prev.clubFacilities?.[fac.id] || 0;
      if (curLv >= fac.maxLv) return prev;

      const calc = calcBulkPurchase(
        curLv,
        fac.maxLv,
        buyAmount,
        prev.money,
        prev.tactics,
        fac.baseG,
        fac.basePt,
        fac.growth
      );
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        clubFacilities: { ...(prev.clubFacilities || {}), [fac.id]: calc.nextLv }
      };
      addLogMsg(next, `🏗️【蒼空FC施設拡充】${fac.name} Lv.${calc.nextLv}へ拡張！（+${calc.count}Lv）`, 'info');
      checkGenomeAwakening(next);
      return next;
    });
  };

  const upgradeLocalClubTier = () => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_solo_carry' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      const curLv = prev.localClubLv || 1;
      // 自分が到達したカテゴリで、上げられる上限が決まる
      let maxLv = 1;
      for (let lv = 2; lv <= 7; lv++) {
        if ((prev.categoryId || 0) >= LOCAL_CLUB_REQ_CAT[lv]) maxLv = lv;
      }
      if (curLv >= maxLv) return prev;
      const calc = calcBulkPurchase(curLv, maxLv, buyAmount, prev.money, prev.tactics, 35000, 140, 2.25);
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        localClubLv: calc.nextLv
      };
      if (calc.nextLv >= 4 && !next.unlockedCharms.includes('charm_club')) {
        next.unlockedCharms = [...next.unlockedCharms, 'charm_club'];
        pushToast('🛡️ 絆のお守り獲得', '「蒼空FC名誉エンブレム」を獲得した！', 'amber');
      }
      addLogMsg(next, `🏆【蒼空FCクラブ昇格】クラブ格付け Lv.${calc.nextLv}へ昇格！`, 'levelup');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 青空FC・無制限財団投資（1x / 10x / MAX統一） ---
  const buyEndlessInvest = (id, label, baseG, basePt) => {
    setGameState((prev) => {
      const curLv = prev.endlessInvest?.[id] || 0;
      const calc = calcBulkPurchase(curLv, 999, buyAmount, prev.money, prev.tactics, baseG, basePt, 1.38);
      if (calc.count === 0) return prev;

      const next = {
        ...prev,
        money: prev.money - calc.totalG,
        tactics: Number((prev.tactics - calc.totalPt).toFixed(1)),
        endlessInvest: { ...(prev.endlessInvest || {}), [id]: calc.nextLv }
      };
      next.statCaps = computeIndividualStatCaps(
        next.generation,
        next.legacyUpgrades,
        next.achievements,
        next.position,
        next.bodyType,
        next.genomes,
        next.fusedGenomes,
        next.secretGenomes,
        next.ascensionUpgrades,
        next.endlessInvest,
        next.posEventCaps,
        next.rivalPerkCaps,
        next.completedTrials,
        next.ascensionCount || 0,
        next.unlockedEndings,
        next.completedChallenges,
        next.activeChallenge,
        next.protegeBonds,
        next.age
      );
      addLogMsg(next, `🏛️【青空FC財団】「${label}」Lv.${calc.nextLv}（+${calc.count}Lv）`, 'info');
      return next;
    });
  };

  // --- 特別アクション：愛弟子指名＆特訓 ---
  //
  // 一度指名したら、その人生のあいだは変更できない。
  // 本人指摘（2026-11-23）:
  //   「弟子システム、すぐ弟子を替えて何回か鍛えるだけで図鑑コンプになってしまう。
  //     1つの人生で1人しか弟子を作れない（途中で変えられない）用にするか」
  //
  // 絆Lv も人生ごとに 1 から。相手はこちらを覚えていない（docs/GAME_DESIGN.md §2）。
  // protegeBonds は図鑑（最高到達Lv）の記録専用にする。
  // 結果として、4人の図鑑を埋めるには最低4周かかる。
  const selectProtege = (archId) => {
    setGameState((prev) => {
      const arch = PROTEGE_ARCHETYPES[archId];
      if (!arch) return prev;
      // 今世すでに弟子がいるなら変更不可
      if (prev.protege?.archetypeId) return prev;
      const next = {
        ...prev,
        protege: { archetypeId: archId, bondLv: 1 },
        protegeBonds: {
          ...(prev.protegeBonds || {}),
          [archId]: Math.max(1, prev.protegeBonds?.[archId] || 0)
        },
        storyFlavor: `🎓【愛弟子指名】${arch.name}（${arch.pos}）と師弟の縁を結んだ。${arch.greetQuote}`
      };
      addLogMsg(next, `🎓【師弟結成】「${arch.name}[${arch.pos}]」を愛弟子に指名（この人生では変更できない）`, 'story');
      pushToast(`🎓 愛弟子：${arch.name}`, `${arch.title}。この人生の弟子はこの子だけ`, 'sky');
      return next;
    });
  };

  const trainProtege = () => {
    setGameState((prev) => {
      const pId = prev.protege?.archetypeId;
      if (!pId) return prev;
      const arch = PROTEGE_ARCHETYPES[pId];
      if (!arch || prev.tactics < 20 || prev.stamina < 10) return prev;
      // 月1回まで。連打で絆Lvを積み上げられると、人生の重みが消える
      const nowMonth = prev.age * 12 + prev.month;
      if (prev.lastProtegeMonth === nowMonth) return prev;

      const nextBond = (prev.protege?.bondLv || 1) + 1;
      const next = {
        ...prev,
        lastProtegeMonth: nowMonth,
        tactics: Number((prev.tactics - 20).toFixed(1)),
        stamina: Number((prev.stamina - 10).toFixed(2)),
        protege: { archetypeId: pId, bondLv: nextBond },
        protegeBonds: {
          ...(prev.protegeBonds || {}),
          [pId]: Math.max(nextBond, prev.protegeBonds?.[pId] || 0)
        },
        careerProtegeExp: (prev.careerProtegeExp || 0) + 2,
        storyFlavor: `🔥【師弟合同特訓】${arch.name}（絆Lv.${nextBond}）：${arch.trainQuote}`
      };
      applyStatGrowth(next, 'tec', 0.25);
      applyStatGrowth(next, 'iq', 0.25);
      addLogMsg(next, `🎓【師弟特訓】${arch.name}との絆が Lv.${nextBond} に上昇！（全能力上限＆連携UP）`, 'levelup');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 特別アクション：宿敵ライバルに直接挑む ---
  const challengeRival = () => {
    setGameState((prev) => {
      if (prev.stamina < 12 || prev.mental < 10) return prev;
      const isEuro = prev.categoryId >= 12;
      const euroObj = EURO_COUNTRIES[prev.euroCountry] || EURO_COUNTRIES.england;
      const tierObj = RIVAL_TIERS[prev.rival?.tierIdx || 0] || RIVAL_TIERS[0];

      const rivalName = isEuro ? euroObj.rivalName : tierObj.name;
      const rivalPow = isEuro ? euroObj.rivalRating : prev.rival?.rating || 18;
      const myPow = getTotalRating(prev);

      const next = {
        ...prev,
        stamina: Number((prev.stamina - 12).toFixed(2)),
        mental: Number((prev.mental - 10).toFixed(2))
      };

      // 勝敗は運ではなく力量で決まる。
      //
      // 本人の指示（2026-11-26）:
      //   「転生するというストーリー上、勝てる相手には絶対勝てるし
      //     そうでない相手には絶対勝てない、というようなより無双系のアレンジがいい」
      //
      // 同じ相手に何度挑んでも、能力が足りないうちは一度も勝てない。
      // 足りた瞬間から確実に勝てるようになる。
      const isWin = myPow >= rivalPow * 0.94;

      if (isWin) {
        const nextWins = (prev.rival?.winsAgainst || 0) + 1;
        const rewardG = Math.round(2500 + CATEGORIES[prev.categoryId].baseReward * 1.1);
        next.money += rewardG;
        next.tactics = Number((next.tactics + 12).toFixed(1));
        next.careerRivalWins = (prev.careerRivalWins || 0) + 1;
        next.rival = {
          ...(prev.rival || {}),
          winsAgainst: nextWins,
          rating: Math.round(rivalPow * 1.14 + 10)
        };
        addZoneCharge(next, 24);

        const winQuote = isEuro
          ? `🔥【欧州スター撃破】${euroObj.rivalName}：${euroObj.defeatQuote}`
          : `🔥【宿敵撃破・通算${nextWins}勝目】${tierObj.name}が膝をついて悔しがる！「クソッ…次は絶対に負けないぞ！」`;
        next.storyFlavor = winQuote;

        if (!isEuro) applyRivalMilestone(next, tierObj, nextWins, pushToast);
        addLogMsg(next, `⚔️【宿敵撃破】「${rivalName}」との1vs1対決に勝利！（賞金+${formatYen(rewardG)}）`, 'match');
      } else {
        applyStatGrowth(next, 'tec', 0.2);
        applyStatGrowth(next, 'phy', 0.2);
        const loseQuote = isEuro
          ? `💢【欧州スターの壁】${euroObj.rivalName}：${euroObj.rivalQuote}（技術・身体 +0.2）`
          : `💢【ライバルの壁】${tierObj.name}：${tierObj.quote}（悔しさをバネに技術・身体 +0.2）`;
        next.storyFlavor = loseQuote;
        addLogMsg(next, `⚔️【宿敵対決】「${rivalName}」に惜敗。悔しさをバネに技術・身体+0.2！`, 'info');
      }

      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 特別アクション：恩師コーチ個別指導 ---
  const doCoachLesson = () => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_lone_wolf' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      if (prev.tactics < 25 || prev.mental < 8) return prev;
      const nextTrust = (prev.relations?.coachTrust || 1) + 1;
      const next = {
        ...prev,
        tactics: Number((prev.tactics - 25).toFixed(1)),
        mental: Number((prev.mental - 8).toFixed(2)),
        careerCoachLessons: (prev.careerCoachLessons || 0) + 1,
        storyFlavor: `📋【恩師の特別指導】「お前の才能ならまだまだ上へ行ける！」コーチの熱血指導で戦術眼と技術が研ぎ澄まされた！`,
        relations: {
          ...prev.relations,
          coachTrust: nextTrust
        }
      };
      applyStatGrowth(next, 'iq', 0.35);
      applyStatGrowth(next, 'tec', 0.2);
      if (nextTrust >= 4 && !next.unlockedCharms.includes('charm_coach')) {
        next.unlockedCharms = [...next.unlockedCharms, 'charm_coach'];
        pushToast('📒 絆のお守り獲得', '「恩師の戦術手帳」を授かった！', 'sky');
      }
      addLogMsg(next, `📋【恩師コーチ指導】戦術+0.35 / 技術+0.20（信頼Lv.${nextTrust}）`, 'story');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 特別アクション：同僚と紅白戦＆飯会 ---
  const doTeamDinner = () => {
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_lone_wolf' || prev.activeChallenge === 'ch_ascetic_god') return prev;
      if (prev.money < 4000 || prev.stamina < 8) return prev;
      const nextChem = (prev.relations?.teamChem || 1) + 1;
      const next = {
        ...prev,
        money: prev.money - 4000,
        stamina: Number((prev.stamina - 8).toFixed(2)),
        mental: Math.min(prev.maxMental, prev.mental + 10),
        careerTeamDinners: (prev.careerTeamDinners || 0) + 1,
        storyFlavor: `🤝【チームの結束】「お前のパスがあれば俺たちはどこまでも勝てる！」仲間との紅白戦と飯会で絆が深まった！`,
        relations: {
          ...prev.relations,
          teamChem: nextChem
        }
      };
      addLogMsg(next, `🤝【同僚と飯会＆連携】チーム連携Lv.${nextChem}に上昇！（試合戦力底上げ）`, 'story');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 特別アクション：恋愛（段階制） ---
  //
  // 本人指摘（2026-11-23）:
  //   「恋人システムも同じようなもので、それぞれ数回ずつクリックするだけで
  //     終わる詰まらない要素という感じになってしまっている。もったいない」
  //
  // 旧: 1回 +10、40 で結婚。4回押せば終わり。
  // 新: 1回 +6、上限100、月1回まで。20/40/60/80/100 の節目で
  //     相手ごとに違う出来事が起きる（src/data/romanceEvents.js）。
  //
  // 好感度は人生ごとにゼロから。相手はこちらを覚えていない。
  // partnerRecords は図鑑（到達した最高好感度）の記録専用。
  const doRomanceEvent = (typeId = null) => {
    setGameState((prev) => {
      if (prev.age < 15 || prev.life.married) return prev;
      if (prev.activeChallenge === 'ch_lone_wolf' || prev.activeChallenge === 'ch_ascetic_god') {
        return prev;
      }
      // 月1回まで。連打で終わらせられる要素にしない
      const nowMonth = prev.age * 12 + prev.month;
      if (prev.lastRomanceMonth === nowMonth) return prev;

      const pType = typeId || prev.life.partnerType || 'childhood';
      const pObj = PARTNER_TYPES[pType] || PARTNER_TYPES.childhood;
      if (!pObj.checkUnlock(prev, getTotalRating(prev))) return prev;

      const costG = 5000;
      const costM = 8;
      if (prev.money < costG || prev.mental < costM) return prev;

      const baseAff = prev.life.partnerType === pType ? prev.life.affection || 0 : 0;
      if (baseAff >= AFFECTION_MAX) return prev;

      const newAff = Math.min(AFFECTION_MAX, baseAff + AFFECTION_PER_DATE);
      const milestone = reachedMilestone(baseAff, newAff);

      // 結婚は好感度100かつ18歳以上
      const canMarry = newAff >= AFFECTION_MARRY && prev.age >= 18;
      const married = canMarry;
      const statusLabel = married
        ? `${pObj.name}と結婚（一途・浮気なし）`
        : `${pObj.name}と交際中 (親密度${newAff}/${AFFECTION_MAX})`;

      let romanceFlavor = `💕【${pObj.name}との時間】街で過ごした。特別なことは何も起きていない。親密度 ${newAff}/${AFFECTION_MAX}。`;
      if (milestone) {
        const writer = ROMANCE_FLAVOR[pType]?.[milestone.key];
        if (writer) {
          romanceFlavor = `【${milestone.label}】\n` + writer(prev, pObj.name);
        }
      }

      const prevRec = prev.partnerRecords?.[pType] || { maxAff: 0, married: false };
      const nextRecords = {
        ...(prev.partnerRecords || {}),
        [pType]: {
          maxAff: Math.max(prevRec.maxAff, newAff),
          married: prevRec.married || married
        }
      };

      const next = {
        ...prev,
        lastRomanceMonth: nowMonth,
        money: prev.money - costG,
        mental: Math.min(prev.maxMental, prev.mental + 8),
        stamina: Math.min(prev.maxStamina, prev.stamina + 8),
        careerTotalAffection: (prev.careerTotalAffection || 0) + AFFECTION_PER_DATE,
        careerFamilyEvents: (prev.careerFamilyEvents || 0) + (married ? 1 : 0),
        storyFlavor: romanceFlavor,
        partnerRecords: nextRecords,
        life: {
          ...prev.life,
          status: statusLabel,
          partnerType: pType,
          affection: newAff,
          married
        }
      };

      // 節目の効果。派手なものは置かない。長く続けた人が少しずつ得をする形にする
      if (milestone) {
        if (milestone.effect === 'charm' && !next.unlockedCharms.includes('charm_lover')) {
          next.unlockedCharms = [...next.unlockedCharms, 'charm_lover'];
          pushToast('🧶 絆のお守り獲得', '「手編みの絆ミサンガ」を受け取った！', 'pink');
        }
        if (milestone.effect === 'mental') {
          next.maxMental = Number((next.maxMental + 10).toFixed(2));
          next.mental = next.maxMental;
        }
        if (milestone.effect === 'growth') {
          next.maxStamina = Number((next.maxStamina + 10).toFixed(2));
          next.tactics = Number((next.tactics + 60).toFixed(1));
        }
        if (milestone.effect === 'stamina') {
          next.maxStamina = Number((next.maxStamina + 15).toFixed(2));
          next.stamina = next.maxStamina;
        }
        if (milestone.effect === 'marry') {
          pushToast('💍 結婚', `${pObj.name}と結婚した（${pObj.perk}）`, 'pink');
        }
        if (milestone.effect !== 'marry') {
          pushToast(`💕 ${milestone.label}`, `${pObj.name}との親密度 ${newAff}/${AFFECTION_MAX}`, 'pink');
        }
      }

      addLogMsg(
        next,
        `💕【オフの交流】${pObj.name}と過ごした（親密度${newAff}/${AFFECTION_MAX} / ${statusLabel}）`,
        'story'
      );
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- 特別アクション：メディア・代表アピール ---
  const doMediaAppeal = () => {
    setGameState((prev) => {
      if (prev.age < 16 || prev.mental < 12) return prev;
      if ((prev.categoryId || 0) < MEDIA_MIN_CAT) return prev;
      if (prev.activeChallenge === 'ch_lone_wolf' || prev.activeChallenge === 'ch_ascetic_god') {
        return prev;
      }
      const gainFans = Math.round(15 + CATEGORIES[prev.categoryId].fanGain * 1.6);
      const gainG = Math.round(4500 + CATEGORIES[prev.categoryId].baseReward * 0.8);
      const next = {
        ...prev,
        mental: Number((prev.mental - 12).toFixed(2)),
        fans: prev.fans + gainFans,
        money: prev.money + gainG,
        careerMediaCount: (prev.careerMediaCount || 0) + 1,
        storyFlavor: `📺【メディア席巻】テレビ特番のインタビューが全国で話題沸騰！ファンが一気に+${formatNum(gainFans)}人増加した！`
      };
      addLogMsg(next, `📺【メディア出演】ファン +${formatNum(gainFans)}人 / 出演料 +${formatYen(gainG)}！`, 'story');
      checkGenomeAwakening(next);
      return next;
    });
  };

  // --- お守り装備トグル ---
  const toggleEquipCharm = (charmId) => {
    setGameState((prev) => {
      if (!prev.unlockedCharms.includes(charmId)) return prev;
      const exists = prev.equippedCharms.includes(charmId);
      if (exists) {
        return { ...prev, equippedCharms: prev.equippedCharms.filter((id) => id !== charmId) };
      }
      if (prev.equippedCharms.length >= prev.maxCharmSlots) {
        return { ...prev, equippedCharms: [...prev.equippedCharms.slice(1), charmId] };
      }
      return { ...prev, equippedCharms: [...prev.equippedCharms, charmId] };
    });
  };

  // --- ハイブリッド特性装備トグル ---
  const toggleEquipTrait = (traitId) => {
    setGameState((prev) => {
      if (!prev.unlockedTraits?.includes(traitId)) return prev;
      const exists = prev.equippedTraits?.includes(traitId);
      if (exists) {
        return { ...prev, equippedTraits: prev.equippedTraits.filter((id) => id !== traitId) };
      }
      const maxT = prev.maxTraitSlots || 2;
      if ((prev.equippedTraits?.length || 0) >= maxT) {
        return { ...prev, equippedTraits: [...prev.equippedTraits.slice(1), traitId] };
      }
      return { ...prev, equippedTraits: [...(prev.equippedTraits || []), traitId] };
    });
  };

  // --- マイ戦術スタイル切替 ---
  // --- 出場ポジションの変更（キャリア中いつでも） ---
  // 以前は転生時にしか選べなかったが、タイムリープでは名前もポジションも
  // 変わらない方が自然なので、転生時の選択をやめて常時変更できるようにした。
  const changePosition = (posId) => {
    setGameState((prev) => {
      if (!POSITIONS[posId] || prev.position === posId) return prev;
      const next = {
        ...prev,
        position: posId,
        statCaps: computeIndividualStatCaps(
          prev.generation,
          prev.legacyUpgrades,
          prev.achievements,
          posId,
          prev.bodyType,
          prev.genomes,
          prev.fusedGenomes,
          prev.secretGenomes,
          prev.ascensionUpgrades,
          prev.endlessInvest,
          prev.posEventCaps,
          prev.rivalPerkCaps,
          prev.completedTrials,
          prev.ascensionCount || 0,
          prev.unlockedEndings,
          prev.completedChallenges,
          prev.activeChallenge,
          prev.protegeBonds,
          prev.age
        )
      };
      const msg = `🔄【コンバート】${POSITIONS[posId].name}として出場することにした。`;
      next.storyFlavor = msg;
      addLogMsg(next, msg, 'story');
      return next;
    });
  };

  const switchTacticalStyle = (styleId) => {
    if (!TACTICAL_STYLES[styleId]) return;
    setGameState((prev) => {
      if (prev.activeChallenge === 'ch_pure_body') return prev;
      if (prev.tacticalStyle === styleId) return prev;
      const next = {
        ...prev,
        tacticalStyle: styleId,
        storyFlavor: `📋【戦術変更】システムを「${TACTICAL_STYLES[styleId].name}」へ切り替えた！`
      };
      addLogMsg(next, `📋【戦術変更】マイ戦術を「${TACTICAL_STYLES[styleId].name}」に変更`, 'info');
      return next;
    });
  };

  // --- 欧州リーグ移籍切替 ---
  const switchEuroCountry = (cId) => {
    if (!EURO_COUNTRIES[cId]) return;
    setGameState((prev) => {
      if (prev.categoryId < 12 || prev.euroCountry === cId) return prev;
      const next = {
        ...prev,
        euroCountry: cId,
        clubName: `${EURO_COUNTRIES[cId].name}・トップクラブ`,
        storyFlavor: `✈️【欧州移籍】${EURO_COUNTRIES[cId].name}（${EURO_COUNTRIES[cId].leagueName}）へ電撃移籍！宿敵 ${EURO_COUNTRIES[cId].rivalName} との頂上決戦へ！`
      };
      addLogMsg(next, `✈️【欧州移籍】${EURO_COUNTRIES[cId].name}のクラブへ移籍！`, 'story');
      return next;
    });
  };

  // --- 縛り輪廻チャレンジ開始（挑戦前の全資産スナップショットを保存！） ---
  const startChallengeRun = (chDef) => {
    setGameState((prev) => {
      const snapshot = {
        legacyPoints: prev.legacyPoints,
        legacyUpgrades: { ...(prev.legacyUpgrades || {}) },
        ascensionCount: prev.ascensionCount || 0,
        ascensionPoints: prev.ascensionPoints || 0,
        ascensionUpgrades: { ...(prev.ascensionUpgrades || {}) },
        breakthroughs: { ...(prev.breakthroughs || {}) },
        upgrades: { ...(prev.upgrades || {}) },
        mastery: { ...(prev.mastery || {}) },
        localClubLv: prev.localClubLv || 1,
        clubMates: { ...(prev.clubMates || {}) },
        clubFacilities: { ...(prev.clubFacilities || {}) },
        unlockedCharms: [...(prev.unlockedCharms || [])],
        equippedCharms: [...(prev.equippedCharms || [])],
        unlockedTraits: [...(prev.unlockedTraits || [])],
        equippedTraits: [...(prev.equippedTraits || [])],
        hobbies: { ...(prev.hobbies || {}) },
        prophecyLv: prev.prophecyLv || 0
      };

      const nextGenNum = (prev.totalGenerations || prev.generation) + 1;
      const nextSt = createInitialState(
        prev.generation + 1,
        prev.legacyPoints,
        prev.legacyUpgrades,
        prev.hallOfFame,
        prev.achievements,
        { playerName: prev.playerName, bodyType: prev.bodyType, position: prev.position },
        prev.genomes,
        prev.fusedGenomes,
        prev.archivedGenomes,
        prev.secretGenomes,
        {
          totalCareerGoals: prev.totalCareerGoals || 0,
          totalCareerAssists: prev.totalCareerAssists || 0,
          careerWins: prev.careerWins || 0,
          careerTotalMatches: prev.careerTotalMatches || 0,
          careerDefMatches: prev.careerDefMatches || 0,
          careerVeteranMonths: prev.careerVeteranMonths || 0,
          careerDrillCounts: { ...prev.careerDrillCounts },
          careerPosMatches: { ...prev.careerPosMatches },
          careerBodyWins: { ...prev.careerBodyWins },
          careerPathWins: { ...prev.careerPathWins },
          careerPathMatches: { ...prev.careerPathMatches },
          careerUnderdogCups: prev.careerUnderdogCups || 0,
          careerUniPoints: prev.careerUniPoints || 0,
          careerTotalAffection: prev.careerTotalAffection || 0,
          careerFamilyEvents: prev.careerFamilyEvents || 0,
          careerHobbyTotalLv: prev.careerHobbyTotalLv || 0,
          careerCoachLessons: prev.careerCoachLessons || 0,
          careerTeamDinners: prev.careerTeamDinners || 0,
          careerRivalWins: prev.careerRivalWins || 0,
          careerMediaCount: prev.careerMediaCount || 0,
          careerEuroCcWins: prev.careerEuroCcWins || 0,
          careerWorldWins: prev.careerWorldWins || 0,
          careerProtegeExp: prev.careerProtegeExp || 0,
          careerSonWins: prev.careerSonWins || 0,
          careerDaughterWins: prev.careerDaughterWins || 0
        },
        null,
        {
          ascensionCount: prev.ascensionCount || 0,
          ascensionPoints: prev.ascensionPoints || 0,
          ascensionUpgrades: { ...(prev.ascensionUpgrades || {}) },
          totalGenerations: nextGenNum,
          completedTrials: [...(prev.completedTrials || [])]
        },
        prev.unlockedCharms,
        prev.equippedCharms,
        {
          posEventsDone: [...(prev.posEventsDone || [])],
          posEventCaps: { ...(prev.posEventCaps || {}) },
          rivalPerksUnlocked: [...(prev.rivalPerksUnlocked || [])],
          rivalPerkCaps: { ...(prev.rivalPerkCaps || {}) },
          localClubLv: prev.localClubLv || 1,
          clubMates: { ...(prev.clubMates || {}) },
          clubFacilities: { ...(prev.clubFacilities || {}) },
          rivalCoopUnlocked: Boolean(prev.rivalCoopUnlocked),
          unlockedTraits: [...(prev.unlockedTraits || [])],
          equippedTraits: [...(prev.equippedTraits || [])],
          intlCupsWon: prev.intlCupsWon || 0,
          protegeData: prev.protege || { archetypeId: null, bondLv: 1 },
          protegeBonds: { ...(prev.protegeBonds || {}) },
          partnerRecords: { ...(prev.partnerRecords || {}) },
          tacticalMastery: { ...(prev.tacticalMastery || {}) },
          euroMastery: { ...(prev.euroMastery || {}) },
          retainedHobbies: { ...(prev.hobbies || {}) },
          prophecyLv: prev.prophecyLv || 0
        },
        prev.breakthroughs,
        prev.mastery,
        [...(prev.unlockedEndings || [])],
        [...(prev.completedChallenges || [])],
        chDef.id,
        'balanced',
        prev.qolToggles || { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false },
        snapshot
      );
      return {
        ...nextSt,
        tutorialSeenVersion: prev.tutorialSeenVersion || CURRENT_TUTORIAL_VERSION
      };
    });
    setBottomTab('matches');
    pushToast(`⚔️ チャレンジ開始: ${chDef.code}`, `${chDef.ruleText}（終了後に元資産へ完全復元）`, 'rose');
  };

  // --- 縛りチャレンジの途中棄権＆元資産完全復元 ---
  const abandonChallengeRun = () => {
    setGameState((prev) => {
      if (!prev.activeChallenge) return prev;
      const snap = prev.preChallengeSnapshot;
      const nextGenNum = (prev.totalGenerations || prev.generation) + 1;
      const restored = createInitialState(
        prev.generation + 1,
        snap ? snap.legacyPoints : prev.legacyPoints,
        snap ? snap.legacyUpgrades : prev.legacyUpgrades,
        prev.hallOfFame,
        prev.achievements,
        { playerName: prev.playerName, bodyType: prev.bodyType, position: prev.position },
        prev.genomes,
        prev.fusedGenomes,
        prev.archivedGenomes,
        prev.secretGenomes,
        {
          totalCareerGoals: prev.totalCareerGoals || 0,
          totalCareerAssists: prev.totalCareerAssists || 0,
          careerWins: prev.careerWins || 0,
          careerTotalMatches: prev.careerTotalMatches || 0,
          careerDefMatches: prev.careerDefMatches || 0,
          careerVeteranMonths: prev.careerVeteranMonths || 0,
          careerDrillCounts: { ...prev.careerDrillCounts },
          careerPosMatches: { ...prev.careerPosMatches },
          careerBodyWins: { ...prev.careerBodyWins },
          careerPathWins: { ...prev.careerPathWins },
          careerPathMatches: { ...prev.careerPathMatches },
          careerUnderdogCups: prev.careerUnderdogCups || 0,
          careerUniPoints: prev.careerUniPoints || 0,
          careerTotalAffection: prev.careerTotalAffection || 0,
          careerFamilyEvents: prev.careerFamilyEvents || 0,
          careerHobbyTotalLv: prev.careerHobbyTotalLv || 0,
          careerCoachLessons: prev.careerCoachLessons || 0,
          careerTeamDinners: prev.careerTeamDinners || 0,
          careerRivalWins: prev.careerRivalWins || 0,
          careerMediaCount: prev.careerMediaCount || 0,
          careerEuroCcWins: prev.careerEuroCcWins || 0,
          careerWorldWins: prev.careerWorldWins || 0,
          careerProtegeExp: prev.careerProtegeExp || 0,
          careerSonWins: prev.careerSonWins || 0,
          careerDaughterWins: prev.careerDaughterWins || 0
        },
        snap ? snap.upgrades : null,
        {
          ascensionCount: snap ? snap.ascensionCount : prev.ascensionCount || 0,
          ascensionPoints: snap ? snap.ascensionPoints : prev.ascensionPoints || 0,
          ascensionUpgrades: snap ? snap.ascensionUpgrades : { ...(prev.ascensionUpgrades || {}) },
          totalGenerations: nextGenNum,
          completedTrials: [...(prev.completedTrials || [])]
        },
        snap ? snap.unlockedCharms : prev.unlockedCharms,
        snap ? snap.equippedCharms : prev.equippedCharms,
        {
          posEventsDone: [...(prev.posEventsDone || [])],
          posEventCaps: { ...(prev.posEventCaps || {}) },
          rivalPerksUnlocked: [...(prev.rivalPerksUnlocked || [])],
          rivalPerkCaps: { ...(prev.rivalPerkCaps || {}) },
          localClubLv: snap ? snap.localClubLv : prev.localClubLv || 1,
          clubMates: snap ? snap.clubMates : { ...(prev.clubMates || {}) },
          clubFacilities: snap ? snap.clubFacilities : { ...(prev.clubFacilities || {}) },
          rivalCoopUnlocked: Boolean(prev.rivalCoopUnlocked),
          unlockedTraits: snap ? snap.unlockedTraits : [...(prev.unlockedTraits || [])],
          equippedTraits: snap ? snap.equippedTraits : [...(prev.equippedTraits || [])],
          intlCupsWon: prev.intlCupsWon || 0,
          protegeData: prev.protege || { archetypeId: null, bondLv: 1 },
          protegeBonds: { ...(prev.protegeBonds || {}) },
          partnerRecords: { ...(prev.partnerRecords || {}) },
          tacticalMastery: { ...(prev.tacticalMastery || {}) },
          euroMastery: { ...(prev.euroMastery || {}) },
          retainedHobbies: snap ? snap.hobbies : { ...(prev.hobbies || {}) },
          prophecyLv: snap ? snap.prophecyLv : prev.prophecyLv || 0
        },
        snap ? snap.breakthroughs : prev.breakthroughs,
        snap ? snap.mastery : prev.mastery,
        [...(prev.unlockedEndings || [])],
        [...(prev.completedChallenges || [])],
        null,
        prev.tacticalStyle || 'balanced',
        prev.qolToggles || { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false },
        null
      );
      return {
        ...restored,
        tutorialSeenVersion: prev.tutorialSeenVersion || CURRENT_TUTORIAL_VERSION
      };
    });
    pushToast('🔄 チャレンジ終了', '挑戦前の全資産・ブレイクスルー・習慣熟練を完全に復元しました！', 'sky');
  };

  // --- 第1段階転生：継承結晶アップグレード購入（前提条件チェック＆超過装備補正） ---
  const buyLegacyUpgrade = (upg) => {
    setGameState((prev) => {
      if (upg.requiresId && (prev.legacyUpgrades?.[upg.requiresId] || 0) < 1) return prev;
      const curLv = prev.legacyUpgrades?.[upg.id] || 0;
      const maxLv = upg.maxLv || 99;
      if (curLv >= maxLv) return prev;

      const calc = calcBulkSingleResource(curLv, maxLv, buyAmount, prev.legacyPoints, upg.baseCost, upg.growth);
      if (calc.count === 0) return prev;

      const nextLegacyUpgrades = { ...prev.legacyUpgrades, [upg.id]: calc.nextLv };
      const memLv = nextLegacyUpgrades.tactical_memory || 0;
      const schedLv = prev.upgrades?.ai_schedule || 0;
      const newCaps = computeIndividualStatCaps(
        prev.generation,
        nextLegacyUpgrades,
        prev.achievements,
        prev.position,
        prev.bodyType,
        prev.genomes,
        prev.fusedGenomes,
        prev.secretGenomes,
        prev.ascensionUpgrades,
        prev.endlessInvest,
        prev.posEventCaps,
        prev.rivalPerkCaps,
        prev.completedTrials,
        prev.ascensionCount || 0,
        prev.unlockedEndings,
        prev.completedChallenges,
        prev.activeChallenge,
        prev.protegeBonds,
        prev.age
      );

      const nextQol = {
        ...prev.qolToggles,
        autoGearBuy: upg.id === 'auto_gear_agent' ? true : prev.qolToggles?.autoGearBuy !== false,
        autoSocialRun: upg.id === 'auto_social_secretary' ? true : prev.qolToggles?.autoSocialRun !== false
      };
      const nextAutoActions =
        upg.id === 'auto_drill_switcher' && prev.unlocks.autoFeature
          ? computeOptimalAutoList(prev)
          : prev.autoActions;

      const next = {
        ...prev,
        legacyPoints: prev.legacyPoints - calc.totalCost,
        legacyUpgrades: nextLegacyUpgrades,
        qolToggles: nextQol,
        autoActions: nextAutoActions,
        statCaps: newCaps,
        maxCharmSlots: computeMaxCharmSlots(nextLegacyUpgrades, prev.ascensionUpgrades, prev.genomes),
        maxTraitSlots: computeMaxTraitSlots(
          prev.ascensionCount || 0,
          prev.ascensionUpgrades,
          nextLegacyUpgrades,
          prev.breakthroughs
        ),
        maxRetireAge: upg.id === 'iron_body' ? Math.round(prev.maxRetireAge + calc.count * 2.0) : prev.maxRetireAge,
        maxAutoSlots: prev.breakthroughs?.smart_auto_all ? 5 : Math.min(5, 1 + memLv + Math.min(4, schedLv))
      };
      addLogMsg(next, `💎【継承強化】「${upg.name}」Lv.${calc.nextLv}を刻んだ！（+${calc.count}Lv）`, 'levelup');
      if (upg.id === 'speed_2x') pushToast('⏩ 2x倍速解放！', 'ヘッダーから2x速度をいつでも選択できます！', 'sky');
      if (upg.id === 'speed_4x') pushToast('⏩ 4x超加速解放！', 'ヘッダーから4x速度をいつでも選択できます！', 'amber');
      return next;
    });
  };

  // --- 上位転生（第2〜第5段階）アップグレード購入（8x速度解放対応） ---
  const buyAscensionUpgrade = (upg) => {
    setGameState((prev) => {
      const curLv = prev.ascensionUpgrades?.[upg.id] || 0;
      const maxLv = upg.maxLv || 99;
      if (curLv >= maxLv) return prev;

      const calc = calcBulkSingleResource(curLv, maxLv, buyAmount, prev.ascensionPoints || 0, upg.baseCost, upg.growth);
      if (calc.count === 0) return prev;

      const nextAscUpgrades = { ...(prev.ascensionUpgrades || {}), [upg.id]: calc.nextLv };
      const newCaps = computeIndividualStatCaps(
        prev.generation,
        prev.legacyUpgrades,
        prev.achievements,
        prev.position,
        prev.bodyType,
        prev.genomes,
        prev.fusedGenomes,
        prev.secretGenomes,
        nextAscUpgrades,
        prev.endlessInvest,
        prev.posEventCaps,
        prev.rivalPerkCaps,
        prev.completedTrials,
        prev.ascensionCount || 0,
        prev.unlockedEndings,
        prev.completedChallenges,
        prev.activeChallenge,
        prev.protegeBonds,
        prev.age
      );

      const next = {
        ...prev,
        ascensionPoints: (prev.ascensionPoints || 0) - calc.totalCost,
        ascensionUpgrades: nextAscUpgrades,
        maxCharmSlots: computeMaxCharmSlots(prev.legacyUpgrades, nextAscUpgrades, prev.genomes),
        maxTraitSlots: computeMaxTraitSlots(
          prev.ascensionCount || 0,
          nextAscUpgrades,
          prev.legacyUpgrades,
          prev.breakthroughs
        ),
        statCaps: newCaps
      };
      addLogMsg(next, `👑【神域超越強化】「${upg.name}」Lv.${calc.nextLv}を刻んだ！（+${calc.count}Lv）`, 'levelup');
      if (upg.id === 'speed_8x') pushToast('⚡ 8x極限加速解放！', 'ヘッダーから8x速度を選択できます！', 'amber');
      return next;
    });
  };

  // --- 進路選択の確定 ---
  const handleSelectCareerPath = (opt) => {
    if (!opt.unlocked) return;
    if (Date.now() - modalOpenedAtRef.current < 850) return;

    setGameState((prev) => {
      const next = {
        ...prev,
        careerPath: opt.id,
        careerPathLabel: opt.shortTitle,
        clubName: opt.clubTitle || opt.shortTitle,
        categoryId: Math.max(prev.categoryId, opt.setCategoryId ?? prev.categoryId),
        money: prev.money + (opt.bonusMoney || 0),
        storyFlavor: `🧭【進路決定】「${opt.title}」へ進学！新たな仲間とライバルが待つ舞台へ踏み出した！`,
        achievements:
          opt.achievementId && !prev.achievements.includes(opt.achievementId)
            ? [...prev.achievements, opt.achievementId]
            : prev.achievements
      };
      addLogMsg(next, `🧭【進路決定】「${opt.title}」へ進んだ！`, 'story');
      next.pendingModal = null;
      return next;
    });
    setCareerChoiceModal(null);
  };

  // --- 強制タイムリープモーダル確認 ---
  const handleProceedFromTruckModal = (mode = 'reincarnate') => {
    if (Date.now() - modalOpenedAtRef.current < 850) return;
    setTruckEventModal(null);
    setGameState((prev) => ({ ...prev, pendingModal: null }));
    openCreatorModal(mode);
  };

  // --- 選手クリエイトモーダル起動 ---
  const openCreatorModal = (mode) => {
    setConfirmReincarnate(false);
    setConfirmAscend(false);
    const gainHoly = mode === 'ascend' ? calculateAscensionGain(gameState) : 0;
    setCreatorModal({
      open: true,
      mode,
      ascensionAwarded: gainHoly,
      playerName: gameState.playerName,
      bodyType: gameState.bodyType,
      position: gameState.position,
      selectedChallenge: null
    });
  };

  // --- 転生・新規開始確定（第二転生以降のタイムリープ趣旨リセット＆フレーバーテキスト強化！） ---
  const handleConfirmCreator = () => {
    // 転生直後に時間を止めるか（設定で切り替えられる）
    if (creatorModal.mode !== 'new' && gameState.qolToggles?.pauseOnRebirth !== false) {
      setIsPaused(true);
    }

    const profile = {
      playerName: creatorModal.playerName.trim() || '蒼井 翼',
      bodyType: creatorModal.bodyType,
      position: creatorModal.position
    };

    if (creatorModal.mode === 'new') {
      setGameState({
        ...createInitialState(1, 0, {}, [], [], profile),
        tutorialSeenVersion: CURRENT_TUTORIAL_VERSION
      });
      setCreatorModal((prev) => ({ ...prev, open: false }));
      setBottomTab('matches');
      return;
    }

    if (creatorModal.mode === 'ascend') {
      setGameState((prev) => {
        const workingPrev = { ...prev };
        checkGenomeAwakening(workingPrev, true);

        const gainHolyPts = calculateAscensionGain(workingPrev);
        const hofEntry = {
          gen: workingPrev.totalGenerations || workingPrev.generation,
          name: workingPrev.playerName,
          pos: workingPrev.position,
          height: workingPrev.targetHeight,
          cat: CATEGORIES[workingPrev.categoryId].name,
          rating: Math.max(workingPrev.peakRatingReached || 0, getTotalRating(workingPrev)),
          goals: workingPrev.goals,
          assists: workingPrev.assists,
          crystals: 0
        };

        const nextGenNum = (workingPrev.totalGenerations || workingPrev.generation) + 1;
        const nextAscCount = (workingPrev.ascensionCount || 0) + 1;
        // 第二転生・第三転生時は「タイムリープの原点回帰」として習慣熟練も深くリセットしつつ聖杯で超成長
        const isSecondPlusAsc = nextAscCount >= 2;

        // 上位転生は「差し出して、代わりに上の段階へ行く」ための転生。
        // 本人指摘（2026-11-23）:
        //   「2次転生してすぐ1次転生ができるゲームバランスはつまらない。
        //     なんとかして2次転生後はポンコツ状態にして、
        //     もう一度弱くなったけどさらに強くなるため頑張る！ってノリにしたい」
        //
        // 継承結晶はもともと失う設計だったが、ゲノムをそのまま持ち越していたため
        // 転生直後から戦力が残っていた。ゲノムと融合ゲノムも手放す。
        // どちらも能力値から自動で再解放される仕組みなので、
        // 鍛え直せば戻る＝「もう一度積み上げる」対象になる。
        //
        // 残すもの: 隠しゲノム・進路アーカイブ・ED・試練・チャレンジ達成・
        //           弟子と恋人の図鑑記録・特性の解放記録
        const wipedGenomes = {};
        const wipedFused = [];

        const nextSt = createInitialState(
          nextGenNum,
          0,
          {},
          [hofEntry, ...(workingPrev.hallOfFame || [])].slice(0, 20),
          workingPrev.achievements,
          profile,
          wipedGenomes,
          wipedFused,
          workingPrev.archivedGenomes,
          workingPrev.secretGenomes,
          {
            totalCareerGoals: workingPrev.totalCareerGoals || 0,
            totalCareerAssists: workingPrev.totalCareerAssists || 0,
            careerWins: workingPrev.careerWins || 0,
            careerTotalMatches: workingPrev.careerTotalMatches || 0,
            careerDefMatches: workingPrev.careerDefMatches || 0,
            careerVeteranMonths: workingPrev.careerVeteranMonths || 0,
            careerDrillCounts: { ...workingPrev.careerDrillCounts },
            careerPosMatches: { ...workingPrev.careerPosMatches },
            careerBodyWins: { ...workingPrev.careerBodyWins },
            careerPathWins: { ...workingPrev.careerPathWins },
            careerPathMatches: { ...workingPrev.careerPathMatches },
            careerUnderdogCups: workingPrev.careerUnderdogCups || 0,
            careerUniPoints: workingPrev.careerUniPoints || 0,
            careerTotalAffection: workingPrev.careerTotalAffection || 0,
            careerFamilyEvents: workingPrev.careerFamilyEvents || 0,
            careerHobbyTotalLv: workingPrev.careerHobbyTotalLv || 0,
            careerCoachLessons: workingPrev.careerCoachLessons || 0,
            careerTeamDinners: workingPrev.careerTeamDinners || 0,
            careerRivalWins: workingPrev.careerRivalWins || 0,
            careerMediaCount: workingPrev.careerMediaCount || 0,
            careerEuroCcWins: workingPrev.careerEuroCcWins || 0,
            careerWorldWins: workingPrev.careerWorldWins || 0,
            careerProtegeExp: workingPrev.careerProtegeExp || 0,
            careerSonWins: workingPrev.careerSonWins || 0,
            careerDaughterWins: workingPrev.careerDaughterWins || 0
          },
          null,
          {
            ascensionCount: nextAscCount,
            ascensionPoints: (workingPrev.ascensionPoints || 0) + gainHolyPts,
            ascensionUpgrades: { ...(workingPrev.ascensionUpgrades || {}) },
            totalGenerations: nextGenNum,
            completedTrials: [...(workingPrev.completedTrials || [])]
          },
          workingPrev.unlockedCharms,
          workingPrev.equippedCharms,
          {
            // イベントを見た記録は残すが、そこで得た上限ボーナスは手放す。
            // クラブも、国際タイトルの蓄積も一から。
            posEventsDone: [...(workingPrev.posEventsDone || [])],
            posEventCaps: {},
            rivalPerksUnlocked: [...(workingPrev.rivalPerksUnlocked || [])],
            rivalPerkCaps: {},
            localClubLv: 1,
            clubMates: {},
            clubFacilities: {},
            rivalCoopUnlocked: Boolean(workingPrev.rivalCoopUnlocked),
            unlockedTraits: [...(workingPrev.unlockedTraits || [])],
            equippedTraits: [],
            intlCupsWon: 0,
            protegeData: workingPrev.protege || { archetypeId: null, bondLv: 1 },
            protegeBonds: { ...(workingPrev.protegeBonds || {}) },
            partnerRecords: { ...(workingPrev.partnerRecords || {}) },
            tacticalMastery: { ...(workingPrev.tacticalMastery || {}) },
            euroMastery: { ...(workingPrev.euroMastery || {}) },
            retainedHobbies: { ...(workingPrev.hobbies || {}) },
            prophecyLv: workingPrev.prophecyLv || 0
          },
          {},
          isSecondPlusAsc ? {} : { ...(workingPrev.mastery || {}) },
          [...(workingPrev.unlockedEndings || [])],
          [...(workingPrev.completedChallenges || [])],
          null,
          workingPrev.tacticalStyle || 'balanced',
          workingPrev.qolToggles || { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false },
          null
        );

        let ascFlavor;
        try {
          ascFlavor = ascensionFlavor(workingPrev, nextAscCount, gainHolyPts);
        } catch {
          ascFlavor = `【第${nextAscCount + 1}段階転生】超越の聖杯 ${gainHolyPts} を得て、再び5歳の春へ。`;
        }

        return {
          ...nextSt,
          storyFlavor: `【第${nextAscCount + 1}段階転生】超越の聖杯 🏆+${gainHolyPts} を得て、再び5歳の春へ。`,
          // 本文はモーダルで読ませる。ステータス欄は2行しか出ない
          pendingEnding: {
            id: `asc_${nextAscCount}`,
            code: `👑 第${nextAscCount + 1}段階転生`,
            name: '',
            sub: `超越の聖杯 🏆+${gainHolyPts}`,
            reward: '',
            text: ascFlavor
          },
          tutorialSeenVersion: workingPrev.tutorialSeenVersion || CURRENT_TUTORIAL_VERSION
        };
      });
      setBottomTab('matches');
    } else {
      setGameState((prev) => {
        const workingPrev = { ...prev };
        checkGenomeAwakening(workingPrev, true);

        const gainPts = calculateLegacyGain(workingPrev);
        const hofEntry = {
          gen: workingPrev.totalGenerations || workingPrev.generation,
          name: workingPrev.playerName,
          pos: workingPrev.position,
          height: workingPrev.targetHeight,
          cat: CATEGORIES[workingPrev.categoryId].name,
          rating: Math.max(workingPrev.peakRatingReached || 0, getTotalRating(workingPrev)),
          goals: workingPrev.goals,
          assists: workingPrev.assists,
          crystals: gainPts
        };

        const carriedUpgrades = {};
        if (workingPrev.breakthroughs?.reincarnate_compass) {
          for (const [k, v] of Object.entries(workingPrev.upgrades || {})) {
            carriedUpgrades[k] = Math.floor(v * 0.5);
          }
        }

        const nextGenNum = (workingPrev.totalGenerations || workingPrev.generation) + 1;
        const nextSt = createInitialState(
          workingPrev.generation + 1,
          workingPrev.legacyPoints + gainPts,
          workingPrev.legacyUpgrades,
          [hofEntry, ...(workingPrev.hallOfFame || [])].slice(0, 20),
          workingPrev.achievements,
          profile,
          workingPrev.genomes,
          workingPrev.fusedGenomes,
          workingPrev.archivedGenomes,
          workingPrev.secretGenomes,
          {
            totalCareerGoals: workingPrev.totalCareerGoals || 0,
            totalCareerAssists: workingPrev.totalCareerAssists || 0,
            careerWins: workingPrev.careerWins || 0,
            careerTotalMatches: workingPrev.careerTotalMatches || 0,
            careerDefMatches: workingPrev.careerDefMatches || 0,
            careerVeteranMonths: workingPrev.careerVeteranMonths || 0,
            careerDrillCounts: { ...workingPrev.careerDrillCounts },
            careerPosMatches: { ...workingPrev.careerPosMatches },
            careerBodyWins: { ...workingPrev.careerBodyWins },
            careerPathWins: { ...workingPrev.careerPathWins },
            careerPathMatches: { ...workingPrev.careerPathMatches },
            careerUnderdogCups: workingPrev.careerUnderdogCups || 0,
            careerUniPoints: workingPrev.careerUniPoints || 0,
            careerTotalAffection: workingPrev.careerTotalAffection || 0,
            careerFamilyEvents: workingPrev.careerFamilyEvents || 0,
            careerHobbyTotalLv: workingPrev.careerHobbyTotalLv || 0,
            careerCoachLessons: workingPrev.careerCoachLessons || 0,
            careerTeamDinners: workingPrev.careerTeamDinners || 0,
            careerRivalWins: workingPrev.careerRivalWins || 0,
            careerMediaCount: workingPrev.careerMediaCount || 0,
            careerEuroCcWins: workingPrev.careerEuroCcWins || 0,
            careerWorldWins: workingPrev.careerWorldWins || 0,
            careerProtegeExp: workingPrev.careerProtegeExp || 0,
            careerSonWins: workingPrev.careerSonWins || 0,
            careerDaughterWins: workingPrev.careerDaughterWins || 0
          },
          carriedUpgrades,
          {
            ascensionCount: workingPrev.ascensionCount || 0,
            ascensionPoints: workingPrev.ascensionPoints || 0,
            ascensionUpgrades: { ...(workingPrev.ascensionUpgrades || {}) },
            totalGenerations: nextGenNum,
            completedTrials: [...(workingPrev.completedTrials || [])]
          },
          workingPrev.unlockedCharms,
          workingPrev.equippedCharms,
          {
            posEventsDone: [...(workingPrev.posEventsDone || [])],
            posEventCaps: { ...(workingPrev.posEventCaps || {}) },
            rivalPerksUnlocked: [...(workingPrev.rivalPerksUnlocked || [])],
            rivalPerkCaps: { ...(workingPrev.rivalPerkCaps || {}) },
            localClubLv: workingPrev.localClubLv || 1,
            clubMates: { ...(workingPrev.clubMates || {}) },
            clubFacilities: { ...(workingPrev.clubFacilities || {}) },
            rivalCoopUnlocked: Boolean(workingPrev.rivalCoopUnlocked),
            unlockedTraits: [...(workingPrev.unlockedTraits || [])],
            equippedTraits: [...(workingPrev.equippedTraits || [])],
            intlCupsWon: workingPrev.intlCupsWon || 0,
            protegeData: workingPrev.protege || { archetypeId: null, bondLv: 1 },
            protegeBonds: { ...(workingPrev.protegeBonds || {}) },
            partnerRecords: { ...(workingPrev.partnerRecords || {}) },
            tacticalMastery: { ...(workingPrev.tacticalMastery || {}) },
            euroMastery: { ...(workingPrev.euroMastery || {}) },
            retainedHobbies: { ...(workingPrev.hobbies || {}) },
            prophecyLv: workingPrev.prophecyLv || 0
          },
          workingPrev.breakthroughs,
          workingPrev.mastery,
          [...(workingPrev.unlockedEndings || [])],
          [...(workingPrev.completedChallenges || [])],
          null,
          workingPrev.tacticalStyle || 'balanced',
          workingPrev.qolToggles || { autoGearBuy: true, autoSocialRun: true, autoCareerPath: false, hideCompleted: false },
          null
        );
        return {
          ...nextSt,
          tutorialSeenVersion: workingPrev.tutorialSeenVersion || CURRENT_TUTORIAL_VERSION
        };
      });
      setBottomTab('reincarnate');
      setLeapSubTab('crystal');
    }

    setCreatorModal((prev) => ({ ...prev, open: false }));
  };

  // --- セーブ書き出し・復元・初期化 ---
  const handleExportSave = () => {
    try {
      const json = JSON.stringify(gameState);
      setSaveTransferText(json);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(() => {});
      }
      pushToast('💾 セーブデータ書き出し完了', 'テキスト欄へ出力＆クリップボードへコピーしました！', 'sky');
    } catch (e) {
      pushToast('⚠️ 書き出し失敗', 'データのシリアライズに失敗しました。', 'rose');
    }
  };

  const handleImportSave = () => {
    try {
      const parsed = JSON.parse(saveTransferText.trim());
      if (!parsed || !parsed.stats || typeof parsed.stats.tec !== 'number') {
        pushToast('⚠️ 無効なセーブデータ', '正しいセーブJSONテキストを貼り付けてください。', 'rose');
        return;
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
      setGameState(parsed);
      setShowHelp(false);
      pushToast('✅ セーブデータ復元完了', 'データを正常に読み込みました！', 'emerald');
    } catch (e) {
      pushToast('⚠️ 復元エラー', 'JSON形式が正しくありません。', 'rose');
    }
  };

  const handleHardReset = () => {
    localStorage.removeItem(SAVE_KEY);
    setGameState({
      ...createInitialState(),
      tutorialSeenVersion: CURRENT_TUTORIAL_VERSION
    });
    setConfirmHardReset(false);
    setShowHelp(false);
    setCreatorModal({
      open: true,
      mode: 'new',
      ascensionAwarded: 0,
      playerName: '蒼井 翼',
      bodyType: 'balanced',
      position: 'CF',
      selectedChallenge: null
    });
  };

  // --- 画面描画用メモ化計算 ---
  const rating = getTotalRating(gameState);
  const currentCat = CATEGORIES[gameState.categoryId] || CATEGORIES[0];
  const nextCat = CATEGORIES[gameState.categoryId + 1] || null;
  const legacyGain = calculateLegacyGain(gameState);
  const stage = getCareerStageInfo(gameState.age, gameState.maxRetireAge);
  const currentHeight = getDynamicHeight(gameState.age, gameState.targetHeight);
  const squadRole = getSquadRoleInfo(rating, gameState.categoryId);
  const unrivaledRank = getUnrivaledRank(gameState.age, rating, gameState.totalGenerations || gameState.generation);
  const fanRank = getFanRankInfo(gameState.fans || 0);
  const { effMaxStam, effMaxMent } = getEffectiveMaxResources(gameState);
  const activeSynergies = getActiveSynergies(gameState);
  const isFeverActive = (gameState.zoneFeverMonths || 0) > 0;
  const activeChObj = gameState.activeChallenge
    ? CHALLENGES_DEF.find((c) => c.id === gameState.activeChallenge)
    : null;

  // 挑戦中の縛りチャレンジが、いま達成条件を満たしているか。
  // ヘッダーに常時出す（以前はコードしか出ておらず、何が目標か分からなかった）
  // --- トロフィー集計 ---
  // 実績がタブごとに散っていて「どこまでコンプしたか」が分からなかったので、
  // 殿堂タブに1枚の一覧として集約する。
  const trophySections = [
    {
      key: 'ending',
      label: 'エンディング',
      icon: '📖',
      done: gameState.unlockedEndings?.length || 0,
      total: ENDINGS_DEF.length,
      items: ENDINGS_DEF.map((d) => ({ name: d.name, got: gameState.unlockedEndings?.includes(d.id) }))
    },
    {
      key: 'challenge',
      label: '縛りチャレンジ',
      icon: '⚔️',
      done: gameState.completedChallenges?.length || 0,
      total: CHALLENGES_DEF.length,
      items: CHALLENGES_DEF.map((d) => ({ name: d.name, got: gameState.completedChallenges?.includes(d.id) }))
    },
    {
      key: 'trial',
      label: '神域試練',
      icon: '🔥',
      done: gameState.completedTrials?.length || 0,
      total: ENDGAME_TRIALS_DEF.length,
      items: ENDGAME_TRIALS_DEF.map((d) => ({ name: d.name, got: gameState.completedTrials?.includes(d.id) }))
    },
    {
      key: 'fused',
      label: '融合ゲノム',
      icon: '🧬',
      done: gameState.fusedGenomes?.length || 0,
      total: FUSED_GENOME_DEF.length,
      items: FUSED_GENOME_DEF.map((d) => ({ name: d.name, got: gameState.fusedGenomes?.includes(d.id) }))
    },
    {
      key: 'secret',
      label: '隠しゲノム',
      icon: '🌑',
      done: gameState.secretGenomes?.length || 0,
      total: SECRET_GENOME_DEF.length,
      items: SECRET_GENOME_DEF.map((d) => ({ name: d.name, got: gameState.secretGenomes?.includes(d.id) }))
    },
    {
      key: 'charm',
      label: '絆のお守り',
      icon: '🏅',
      done: gameState.unlockedCharms?.length || 0,
      total: CHARMS_DEF.length,
      items: CHARMS_DEF.map((d) => ({ name: d.name, got: gameState.unlockedCharms?.includes(d.id) }))
    },
    {
      key: 'trait',
      label: 'ハイブリッド特性',
      icon: '⚡',
      done: gameState.unlockedTraits?.length || 0,
      total: POSITION_TRAITS_DEF.length,
      items: POSITION_TRAITS_DEF.map((d) => ({ name: d.name, got: gameState.unlockedTraits?.includes(d.id) }))
    },
    {
      key: 'path',
      label: '進路ゲノム',
      icon: '🧭',
      done: BASE_GENOME_DEF.filter((d) => d.isPathGenome && (gameState.genomes?.[d.id] || 0) >= 5).length,
      total: BASE_GENOME_DEF.filter((d) => d.isPathGenome).length,
      items: BASE_GENOME_DEF.filter((d) => d.isPathGenome).map((d) => ({
        name: d.name.replace(/^【.*?】/, ''),
        got: (gameState.genomes?.[d.id] || 0) >= 5
      }))
    }
  ];
  const trophyDone = trophySections.reduce((a, b) => a + b.done, 0);
  const trophyTotal = trophySections.reduce((a, b) => a + b.total, 0);
  const trophyPct = trophyTotal > 0 ? Math.round((trophyDone / trophyTotal) * 100) : 0;

  const activeChDone = Boolean(
    activeChObj && !gameState.completedChallenges?.includes(activeChObj.id) && activeChObj.checkGoal(gameState)
  );
  const activeChCleared = Boolean(activeChObj && gameState.completedChallenges?.includes(activeChObj.id));

  const isEuroStage = gameState.categoryId >= 12;
  const activeEuroObj = EURO_COUNTRIES[gameState.euroCountry] || EURO_COUNTRIES.england;
  const activeTierObj = RIVAL_TIERS[gameState.rival?.tierIdx || 0] || RIVAL_TIERS[0];
  const activeRivalName = isEuroStage ? activeEuroObj.rivalName : activeTierObj.name;
  const activeRivalRating = isEuroStage ? activeEuroObj.rivalRating : gameState.rival?.rating || 18;
  const activeRivalStory = isEuroStage
    ? activeEuroObj.rivalQuote
    : gameState.rivalCoopUnlocked
      ? activeTierObj.coopQuote
      : activeTierObj.quote;

  const activeProtegeObj = gameState.protege?.archetypeId
    ? PROTEGE_ARCHETYPES[gameState.protege.archetypeId]
    : null;
  const protegeRating = activeProtegeObj
    ? Number((rating * (0.52 + (gameState.protege?.bondLv || 1) * 0.045)).toFixed(1))
    : 0;

  const conditionRatio = gameState.stamina / Math.max(1, gameState.maxStamina);
  const condition =
    conditionRatio >= 1.05
      ? { label: '限界突破150%', badge: 'bg-amber-950 border-amber-400 text-amber-200' }
      : conditionRatio >= 0.72
        ? { label: '絶好調', badge: 'bg-emerald-950 border-emerald-600 text-emerald-300' }
        : conditionRatio >= 0.35
          ? { label: '良好', badge: 'bg-sky-950 border-sky-700 text-sky-300' }
          : { label: '疲労蓄積', badge: 'bg-rose-950 border-rose-700 text-rose-300' };

  const u = gameState.upgrades || {};
  const g = gameState.genomes || {};
  const hb = gameState.hobbies || {};
  const fused = gameState.fusedGenomes || [];
  const pObj = gameState.life?.married ? PARTNER_TYPES[gameState.life.partnerType] : null;
  const cafeLv = gameState.clubFacilities?.fac_cafeteria || 0;
  const commonRecMult =
    (1 + (u.bento_protein || 0) * 0.12) *
    (1 + (hb.cooking || 0) * 0.07) *
    (1 + (g.jr_local_dna || 0) * 0.04) *
    (1 + cafeLv * 0.06) *
    (pObj?.id === 'childhood' ? 1.08 : 1.0) *
    (gameState.equippedCharms?.includes('charm_lover') ? 1.22 : 1.0) *
    (gameState.unlockedEndings?.includes('ed_eternal_50') ? 1.18 : 1.0) *
    (gameState.equippedTraits?.includes('trait_sb') ? 1.12 : 1.0) *
    (activeSynergies.some((x) => x.id === 'syn_iron_dynamo') ? 1.3 : 1.0);
  const stamRecPreview = (
    (4.0 + gameState.maxStamina * 0.075) *
    commonRecMult *
    (1 + (g.engine_dna || 0) * 0.04) *
    (fused.includes('fused_total_football') ? 1.16 : 1.0)
  ).toFixed(1);
  const mentRecPreview = (
    (4.0 + gameState.maxMental * 0.075) *
    commonRecMult *
    (1 + (g.guardian_dna || 0) * 0.04) *
    (1 + (g.romance_bond_dna || 0) * 0.04) *
    (fused.includes('fused_aegis') ? 1.16 : 1.0)
  ).toFixed(1);

  const legLvSum = Object.values(gameState.legacyUpgrades || {}).reduce((a, b) => a + b, 0);
  const ascCount = gameState.ascensionCount || 0;
  // 第2転生以降の解放条件。
  //
  // 設計意図（本人）:
  //   「第二転生を J1 から海外にいくタイミングで行うようなバランスに」
  //   「第三転生は、海外トップリーグで活躍できるかできないかレベルから、
  //     完全無双できるようになる段階」
  //
  // 実測（docs/BALANCE_LOG.md）では 10周目に J1 / 結晶強化計Lv28、
  // 13周目に欧州中堅 / Lv33 なので、旧条件（Lv60・cat12）だと
  // Lv60 到達が27周目あたりになり、意図より15周ぶん遅かった。
  const canUnlockAscension = ascCount >= 1 || legLvSum >= 24 || (gameState.totalGenerations || gameState.generation) >= 5;
  // 段階が上がるごとに要求も上がるが、買える上限（MAX_LEGACY_LV_SUM）の
  // 55% で頭打ちにする。超えると到達不能になって詰む。
  const ascReqCrystalLv = Math.min(Math.floor(MAX_LEGACY_LV_SUM * 0.55), 28 + ascCount * 12);
  const ascReqCatId = Math.min(18, 11 + ascCount);
  // 条件は「いまの所属」ではなく「この人生で到達した最高カテゴリ」で見る。
  //
  // 本人の指摘（2026-11-26）:
  //   「寿命になると強制的に第一転生されるのは困る。第二転生の最後のアイテムが
  //     なかなか買えないので、聖杯の数を集めようと思って何度か第二転生を
  //     周回するつもりだった」
  //
  // 衰えて降格してから引退するので、いまの所属で判定すると
  // 条件を満たしていた人生でも上位転生できずに第一転生へ流されていた。
  const reachedCatId = Math.max(gameState.categoryId || 0, gameState.peakCategoryId || 0);
  const canAscendNow = legLvSum >= ascReqCrystalLv && reachedCatId >= ascReqCatId;
  const ascensionGainPreview = calculateAscensionGain(gameState);

  const stageBadges = [
    null,
    { label: '第2段階・超越者', cls: 'bg-amber-950 border-amber-500 text-amber-300' },
    { label: '第3段階・星辰輪廻', cls: 'bg-fuchsia-950 border-fuchsia-500 text-fuchsia-300' },
    { label: '第4段階・創世神転生', cls: 'bg-rose-950 border-rose-400 text-rose-200' },
    { label: '第5段階・宇宙評議会', cls: 'bg-cyan-950 border-cyan-400 text-cyan-200' }
  ];
  const currentStageBadge = stageBadges[Math.min(4, ascCount)] || null;

  // 周回ごとに1つずつ解放する（docs/GAME_DESIGN.md §21）。
  // 以前は2周目で全部まとめて開いていたため、何が増えたのか分からないまま
  // 画面だけ複雑になっていた。
  const totalGens = gameState.totalGenerations || gameState.generation || 1;
  const canUse = (id) => isFeatureUnlocked(id, totalGens, ascCount);
  // この周回で新しく解放された機能（解放モーダル用）
  const unlockModalItems = (gameState.pendingUnlocks || [])
    .map((id) => GENERATION_UNLOCKS.find((u) => u.id === id))
    .filter(Boolean);

  const canGear = canUse('gear');
  const canProtege = canUse('protege');
  const canCharm = canUse('charm');
  const canTrait = canUse('trait');
  const canHobby = canUse('hobby');
  const canRivalCoop = canUse('rival_coop');
  const canBrand = canUse('brand');
  // 旧名。段階的に個別フラグへ置き換えていく
  const isNextGenUnlocked = canGear;
  const isGearDisabledByCh = gameState.activeChallenge === 'ch_no_gear' || gameState.activeChallenge === 'ch_ascetic_god';
  const isBtDisabledByCh = gameState.activeChallenge === 'ch_no_memory' || gameState.activeChallenge === 'ch_ascetic_god';
  const isSocialDisabledByCh =
    gameState.activeChallenge === 'ch_lone_wolf' || gameState.activeChallenge === 'ch_ascetic_god';
  const isSoloDisabledByCh =
    gameState.activeChallenge === 'ch_solo_carry' || gameState.activeChallenge === 'ch_ascetic_god';

  const activeBaseGenomes = BASE_GENOME_DEF.filter((d) => !(gameState.archivedGenomes || []).includes(d.id));
  const archivedBaseGenomes = BASE_GENOME_DEF.filter((d) => (gameState.archivedGenomes || []).includes(d.id));
  const totalGenomeCount =
    Object.values(g).reduce((a, b) => a + b, 0) +
    (gameState.fusedGenomes?.length || 0) * 3 +
    (gameState.secretGenomes?.length || 0) * 2;

  const protegeCompCount = Object.keys(PROTEGE_ARCHETYPES).filter(
    (id) => (gameState.protegeBonds?.[id] || 0) >= 5
  ).length;
  const partnerCompCount = Object.keys(PARTNER_TYPES).filter(
    (id) => gameState.partnerRecords?.[id]?.married
  ).length;

  const top3ClosestGenomes = activeBaseGenomes
    .map((def) => {
      const curLv = gameState.genomes?.[def.id] || 0;
      const val = def.getStatVal(gameState);
      const isMax = !def.isPathGenome && curLv >= def.maxLv;
      const nextTarget = (curLv + 1) * def.step;
      const prevBase = curLv * def.step;
      const pct = isMax
        ? 100
        : Math.min(99.9, Math.max(0, ((val - prevBase) / Math.max(1, nextTarget - prevBase)) * 100));
      return { def, curLv, val, nextTarget, pct, isMax };
    })
    .filter((item) => !item.isMax)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const visibleAscensionUpgrades = ASCENSION_UPGRADES_DEF.filter((u) => !u.minAsc || ascCount >= u.minAsc);

  const isSpeed2Unlocked = (gameState.legacyUpgrades?.speed_2x || 0) >= 1;
  const isSpeed4Unlocked = (gameState.legacyUpgrades?.speed_4x || 0) >= 1;
  const isSpeed8Unlocked = (gameState.ascensionUpgrades?.speed_8x || 0) >= 1;
  const hideCompleted = Boolean(gameState.qolToggles?.hideCompleted);

  const bodyGenomesList = BASE_GENOME_DEF.filter((d) => d.isBodyGenome);
  const bodyGenomesMasteredCount = bodyGenomesList.filter((d) => (gameState.genomes?.[d.id] || 0) >= 5).length;

  // --- 進路選択カード内に「この進路で育つ遺伝子」の現在地を表示する ---
  const renderGenomeTag = (genomeId, genomeName) => {
    if (!genomeId) return null;
    const lv = gameState.genomes?.[genomeId] || 0;
    const isArchived = (gameState.archivedGenomes || []).includes(genomeId);
    const label = isArchived ? `極意到達・超越Lv.${lv}` : lv > 0 ? `Lv.${lv} / 5` : '未覚醒';
    return (
      <div className="flex items-center justify-between gap-1 mt-1 pt-1 border-t border-slate-800">
        <span className="text-[9px] text-sky-300 truncate">🧬 {genomeName}</span>
        <span
          className={`font-mono text-[8.5px] shrink-0 ${isArchived ? 'text-amber-300' : lv > 0 ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          {label}
        </span>
      </div>
    );
  };


  return (
    <div className="min-h-screen md:h-screen bg-slate-950 text-slate-200 flex flex-col font-sans select-none overflow-x-hidden md:overflow-hidden">
      {/* ================= ヘッダーバー（2x / 4x / 8x対応） ================= */}
      <header className="shrink-0 bg-slate-900 border-b border-slate-800 px-2 py-1 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-indigo-950 border border-indigo-700 text-indigo-300 shrink-0">
            周回.{gameState.totalGenerations || gameState.generation}
          </span>
          {currentStageBadge && (
            <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 border shrink-0 ${currentStageBadge.cls}`}>
              {currentStageBadge.label}
            </span>
          )}
          {activeChObj && (
            <span
              title={`${activeChObj.name}
${activeChObj.ruleText}
${activeChObj.goalText}
${activeChObj.rewardText}`}
              className={`font-mono text-[9px] font-bold px-1.5 py-0.5 border shrink-0 max-w-[280px] truncate ${
                activeChCleared
                  ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
                  : activeChDone
                    ? 'bg-amber-950 border-amber-400 text-amber-200'
                    : 'bg-rose-950 border-rose-500 text-rose-200'
              }`}
            >
              縛り:{activeChObj.code}{' '}
              {activeChCleared
                ? '✅ 制覇済'
                : activeChDone
                  ? '🎉 条件達成！'
                  : (activeChObj.goalText || '').replace(/^目標：/, '')}
            </span>
          )}
          <span className="font-bold text-xs text-slate-100 truncate">{gameState.playerName}</span>
          <span className="text-[10px] font-mono text-sky-300 shrink-0">[{gameState.position}]</span>
          <span className={`hidden sm:inline font-mono text-[8.5px] font-bold px-1.5 py-0.2 border shrink-0 ${unrivaledRank.badge}`}>
            🌟 {unrivaledRank.title}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIsPaused((v) => !v)}
            title={isPaused ? '時間を進める' : '時間を止める'}
            className={`px-1.5 py-0.5 text-[10px] font-mono border cursor-pointer ${
              isPaused
                ? 'bg-amber-900 border-amber-400 text-white font-bold'
                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
          {[
            { spd: 1, unlocked: true, tip: '1倍速' },
            { spd: 2, unlocked: isSpeed2Unlocked, tip: 'タイムリープ結晶で「倍速思考(2x)」を購入して解放' },
            { spd: 4, unlocked: isSpeed4Unlocked, tip: '2x解放後、タイムリープ結晶で「超加速思考(4x)」を購入して解放' },
            { spd: 8, unlocked: isSpeed8Unlocked, tip: '上位転生の聖杯で「極限時間加速(8x)」を購入して解放' }
          ].map(({ spd, unlocked, tip }) => (
            <button
              key={spd}
              disabled={!unlocked}
              onClick={() => unlocked && setGameSpeed(spd)}
              title={unlocked ? `${spd}倍速で進行` : tip}
              className={`px-1.5 py-0.5 text-[10px] font-mono border flex items-center gap-0.5 ${
                !unlocked
                  ? 'bg-slate-950/60 border-slate-800 text-slate-600 cursor-not-allowed'
                  : gameSpeed === spd
                    ? 'bg-sky-900 border-sky-400 text-white font-bold cursor-pointer'
                    : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer'
              }`}
            >
              {!unlocked && <Lock size={8} />}
              {spd}x
            </button>
          ))}
          <button
            onClick={() => setShowLogDrawer((v) => !v)}
            className={`px-1.5 py-0.5 text-[10px] font-mono border cursor-pointer flex items-center gap-0.5 ${
              showLogDrawer
                ? 'bg-amber-900/70 border-amber-500 text-amber-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="選手年代記ログを表示/非表示"
          >
            <BookOpen size={11} />
            <span className="hidden sm:inline">年代記</span>
          </button>
          <button
            onClick={() => setTutorialModalOpen(true)}
            className="px-1.5 py-0.5 text-[9.5px] font-mono bg-indigo-950 border border-indigo-600 text-indigo-200 hover:text-white cursor-pointer"
            title="v0.35 ガイドを表示"
          >
            v0.35
          </button>
          <button
            onClick={() => {
              setConfirmHardReset(false);
              setShowHelp(true);
            }}
            className="p-1 bg-slate-950 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            title="システム詳細・セーブ管理"
          >
            <HelpCircle size={12} />
          </button>
        </div>
      </header>

      {/* =================
          いまの状況をひとまとめにした帯。
          本人の要望（2026-11-20）:
            「今のポジション、今の人生での勝利数やゴール数、今のカテゴリ、
              チーム名など、重要な要素を分かりやすく一か所にまとめたい」
          左ペインに散らばっていたので、1行で全部見えるようにした。
          ================= */}
      <div className="shrink-0 bg-slate-950 border-b border-slate-800 px-2 py-1 flex items-center gap-2 overflow-x-auto text-[10px] font-mono whitespace-nowrap">
        <span className="text-amber-300 font-bold">
          {gameState.age}歳{gameState.month}月
        </span>
        <span className="text-slate-600">/</span>
        <span className="text-sky-300">{CATEGORIES[gameState.categoryId].name}</span>
        <span className="text-slate-300">{gameState.clubName}</span>
        <span className="text-slate-600">/</span>
        <span className="text-emerald-300 font-bold">{gameState.position}</span>
        <span className="text-slate-600">/</span>
        <span className="text-slate-300">
          {formatNum(gameState.matchesPlayed)}試合
          <span className="text-amber-200"> {formatNum(gameState.wins)}勝</span>
          <span className="text-rose-200"> {formatNum(gameState.goals)}G</span>
          <span className="text-indigo-200"> {formatNum(gameState.assists)}A</span>
        </span>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200">
          総合 <span className="text-white font-bold">{formatNum(rating, 1)}</span>
          <span className="text-slate-500"> (最高{formatNum(gameState.peakRatingReached || 0, 1)})</span>
        </span>
        {gameState.life?.married && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-pink-300">
              {PARTNER_TYPES[gameState.life.partnerType]?.name || '既婚'}
            </span>
          </>
        )}
        {activeProtegeObj && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-sky-200">
              弟子 {activeProtegeObj.name}（絆{gameState.protege?.bondLv || 1}）
            </span>
          </>
        )}
      </div>

      {/* ================= メインコンテンツ（1画面完全完結設計） ================= */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-1 p-1 overflow-y-auto md:overflow-hidden">
        {/* ---------- 左ペイン：重要資産(円・戦術Pt・ファン)最上部配置＋選手情報＋物語＋人間関係 ---------- */}
        <aside className="md:w-72 lg:w-80 shrink-0 bg-slate-900/90 border border-slate-800 p-1.5 flex flex-col justify-between gap-1 md:overflow-hidden">
          <div className="space-y-1">
            {/* 左上最上部：重要要素エリア（資金[円]・戦術Pt・ファン） */}
            <div className="grid grid-cols-3 gap-1 text-center tabular-nums">
              <div className="bg-slate-950 border border-amber-700/70 py-0.5 px-1 min-w-0">
                <div className="text-[7.5px] text-amber-400/90 font-bold">所持資金</div>
                <div className="font-mono text-[10px] font-extrabold text-amber-300 truncate">
                  {formatYen(gameState.money)}
                </div>
              </div>
              <div className="bg-slate-950 border border-sky-700/70 py-0.5 px-1 min-w-0">
                <div className="text-[7.5px] text-sky-400/90 font-bold">戦術Pt</div>
                <div className="font-mono text-[10px] font-extrabold text-sky-300 truncate">
                  {formatNum(gameState.tactics)}
                </div>
              </div>
              <div className="bg-slate-950 border border-emerald-700/70 py-0.5 px-1 min-w-0">
                <div className="text-[7.5px] text-emerald-400/90 font-bold">ファン</div>
                <div className="font-mono text-[10px] font-extrabold text-emerald-300 truncate">
                  {formatNum(gameState.fans)}人
                </div>
              </div>
            </div>

            {/* 年齢・コンディション・自分の総合力 */}
            <div className="bg-slate-950 border border-sky-800/80 px-2 py-1 flex items-center justify-between gap-1 tabular-nums">
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-mono font-bold text-xs text-slate-100">
                  {gameState.age}歳{gameState.month}月
                </span>
                <span className={`px-1 border text-[8px] font-bold shrink-0 ${condition.badge}`}>
                  {condition.label}
                </span>
                <span className="font-mono text-[8.5px] text-indigo-300 shrink-0">Lv.{gameState.level}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[8.5px] text-slate-400 mr-1">総合力</span>
                <span className="font-mono text-sm font-extrabold text-sky-300 tracking-tight">
                  {formatNum(rating, 1)}
                </span>
              </div>
            </div>

            {/* 🔥 自動ZONEゲージ */}
            <div
              className={`border px-2 py-0.5 text-[9px] tabular-nums ${
                isFeverActive ? 'bg-amber-950/70 border-amber-400' : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-0.5 text-amber-300">
                  <Flame size={9} />
                  {isFeverActive ? `ZONE FEVER 自動発動中 (残${gameState.zoneFeverMonths}ヶ月)` : '自動ZONEゲージ'}
                </span>
                <span className="font-mono text-slate-200">
                  {isFeverActive ? '成長×2.2倍!' : `${Math.floor(gameState.zoneCharge || 0)}%`}
                </span>
              </div>
              <div className="w-full h-1 bg-slate-900 mt-0.5 overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${isFeverActive ? 'bg-amber-400' : 'bg-rose-500'}`}
                  style={{
                    width: `${isFeverActive ? (gameState.zoneFeverMonths / 6) * 100 : gameState.zoneCharge || 0}%`
                  }}
                />
              </div>
            </div>

            {/* 所属カテゴリ ＆ 所属クラブ名 ＋ 序列・身長・体力・精神 */}
            <div className="bg-slate-950 border border-amber-700/60 p-1.5 text-[9.5px] space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[8px] px-1 bg-amber-950 border border-amber-600 text-amber-200 font-bold shrink-0">
                  所属カテゴリ
                </span>
                <span className="font-bold text-amber-300 truncate">{currentCat.name}</span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[8.5px] text-sky-300 font-bold truncate">
                  🏟️ {gameState.clubName || currentCat.clubDefault}
                </span>
                <span className={`px-1 border text-[8px] font-bold shrink-0 ${squadRole.badge}`}>
                  {squadRole.title}
                </span>
              </div>
              <div className="flex items-center justify-between text-[8.5px] text-slate-400 font-mono tabular-nums">
                <span>
                  身長 <strong className="text-slate-200">{currentHeight}cm</strong>
                  {gameState.age < 18 ? '(発育中)' : ''} / 📣 {fanRank.title}
                </span>
                <span className="text-slate-300 truncate">{gameState.careerPathLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-0.5 border-t border-slate-800/80">
                <MiniBar
                  label={gameState.breakthroughs?.overcharge_body ? '体力150%' : '体力'}
                  current={gameState.stamina}
                  max={effMaxStam}
                  colorClass="bg-emerald-500"
                  rateText={`+${stamRecPreview}`}
                />
                <MiniBar
                  label={gameState.breakthroughs?.overcharge_body ? '精神150%' : '精神'}
                  current={gameState.mental}
                  max={effMaxMent}
                  colorClass="bg-sky-500"
                  rateText={`+${mentRecPreview}`}
                />
              </div>
            </div>

            {/* 📖 周囲の反応・物語（高さ固定2行レイアウト） */}
            <div className="bg-indigo-950/35 border border-indigo-700/80 p-1.5 text-[9px] space-y-0.5">
              <div className="flex items-center justify-between text-[8.5px] font-bold text-amber-300">
                <span className="flex items-center gap-1">
                  <MessageSquareQuote size={10} /> 周囲の反応・物語
                </span>
                <span className={`px-1 border text-[8px] ${unrivaledRank.badge}`}>{unrivaledRank.title}</span>
              </div>
              <div className="h-[28px] overflow-hidden">
                <p className="text-slate-200 leading-[14px] line-clamp-2">{gameState.storyFlavor}</p>
              </div>
            </div>

            {/* 人間関係＆愛弟子＆子ども＆宿敵ライバル */}
            <div className="bg-slate-950 border border-slate-800 p-1.5 text-[8.5px] space-y-1 tabular-nums">
              <div className="flex items-center justify-between text-slate-300">
                <span>
                  <Users size={9} className="inline mr-0.5 text-amber-300" />
                  コーチLv.{gameState.relations?.coachTrust || 1} / 同僚Lv.{gameState.relations?.teamChem || 1}
                </span>
                {gameState.age >= 15 && (
                  <span className="text-pink-300 truncate max-w-[130px]">💕 {gameState.life.status}</span>
                )}
              </div>

              {activeProtegeObj && (
                <div className="flex items-center justify-between text-sky-300 border-t border-slate-800/80 pt-0.5">
                  <span className="flex items-center gap-0.5 font-bold truncate">
                    <GraduationCap size={10} /> 愛弟子 {activeProtegeObj.name}[{activeProtegeObj.pos}] 絆Lv.{gameState.protege.bondLv}
                  </span>
                  <span className="font-mono text-emerald-300 shrink-0">総合{formatNum(protegeRating, 1)}</span>
                </div>
              )}

              {gameState.life?.childActive && (
                <div className="flex items-center justify-between text-amber-300 border-t border-slate-800/80 pt-0.5">
                  <span className="font-bold truncate">
                    ⚽ 愛児({gameState.life.childGender === 'daughter' ? '娘' : '息子'}・{gameState.life.childTalent})
                  </span>
                  <span className="font-mono text-emerald-300 shrink-0">
                    総合{formatNum(gameState.life.childRating || 18, 1)}
                  </span>
                </div>
              )}

              <div className="border-t border-rose-900/60 bg-rose-950/20 px-1.5 py-1 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-rose-300 font-bold text-[9px] flex items-center gap-0.5 truncate">
                    <Swords size={9} className="shrink-0" /> 宿敵 {activeRivalName}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="font-mono text-[10px] font-extrabold text-rose-300">
                      総合{formatNum(activeRivalRating, 1)}
                    </span>
                    <span
                      className={`text-[7.5px] font-mono px-1 border ${
                        gameState.rivalCoopUnlocked
                          ? 'bg-amber-950 border-amber-400 text-amber-200 font-bold'
                          : rating >= activeRivalRating * 0.94
                            ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold'
                            : 'bg-rose-950 border-rose-600 text-rose-300'
                      }`}
                    >
                      {gameState.rivalCoopUnlocked
                        ? '共闘済'
                        : rating >= activeRivalRating * 0.94
                          ? '撃破圏内'
                          : '格上'}
                    </span>
                  </div>
                </div>
                <div className="h-[26px] overflow-hidden">
                  <p className="text-[8px] text-rose-100/90 leading-[13px] line-clamp-2">{activeRivalStory}</p>
                </div>
              </div>
            </div>

            {/* 4個人能力ボックス */}
            <div className="grid grid-cols-4 md:grid-cols-2 gap-1">
              {[
                { key: 'tec', label: '技術', color: 'text-sky-300' },
                { key: 'phy', label: '身体', color: 'text-emerald-300' },
                { key: 'iq', label: '戦術', color: 'text-indigo-300' },
                { key: 'sht', label: '決定', color: 'text-rose-300' }
              ].map((st) => {
                const val = gameState.stats[st.key] || 0;
                const cap = gameState.statCaps[st.key] || 10;
                const isCapped = val >= cap;
                return (
                  <div
                    key={st.key}
                    className={`bg-slate-950 border px-1.5 py-0.5 flex flex-col md:flex-row md:items-center justify-between gap-0.5 min-w-0 ${
                      isCapped ? 'border-rose-800/80' : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-0.5 shrink-0">
                      <span className="text-[9px] text-slate-400">{st.label}</span>
                      {isCapped && (
                        <span className="text-[7px] px-0.5 bg-rose-950 text-rose-300 border border-rose-800 leading-tight">
                          限
                        </span>
                      )}
                    </div>
                    <span className={`font-mono text-[10px] font-bold tabular-nums truncate ${st.color}`}>
                      {formatNum(val, val >= 1000 ? 0 : 1)}
                      <span className="text-[8px] text-slate-500 font-normal">/{formatNum(cap)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 左下：継承結晶フッター（通知が被らないよう右下配置に変更済み） */}
          <div className="bg-purple-950/35 border border-purple-700/80 px-2 py-1 flex items-center justify-between text-[9.5px] tabular-nums">
            <span className="text-purple-200">
              継承結晶(引退:{gameState.maxRetireAge}歳{stage.isDecay ? '/衰え中' : ''})
            </span>
            <span className="font-mono font-bold text-purple-300">
              💎 {formatNum(gameState.legacyPoints)} <span className="text-emerald-400">(+{formatNum(legacyGain)})</span>
            </span>
          </div>
        </aside>

        {/* ---------- 中央ペイン ---------- */}
        <main className="flex-1 min-w-0 flex flex-col gap-1 md:overflow-hidden">
          {gameState.isRetired && (
            <div className="shrink-0 bg-purple-950 border border-purple-400 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-purple-100">
                ⏳ 現役キャリア完結！タイムリープして知識とゲノムを次の人生へ継承しよう。
              </span>
              <button
                onClick={() => openCreatorModal('reincarnate')}
                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] cursor-pointer shrink-0"
              >
                タイムリープ実行 (+💎{formatNum(legacyGain)})
              </button>
            </div>
          )}

          {/* 中央上段：5種トレーニング（常時表示） */}
          <section className="shrink-0 bg-slate-900 border border-slate-800 p-1.5 flex flex-col gap-1">
            <div className="bg-slate-950 border border-slate-800 px-2 py-0.5 text-[9.5px] text-slate-300 truncate">
              {inspectorText}
            </div>

            <div className="flex items-center justify-between text-[9px] text-slate-400 px-0.5">
              <span className="font-bold text-slate-300">
                トレーニング（{stage.label} / 自動休憩常時内蔵）
                {!isBtDisabledByCh && gameState.breakthroughs?.batch_5x_train && (
                  <span className="ml-1 text-amber-300">[⚡5倍集中発動中]</span>
                )}
              </span>
              {gameState.unlocks.autoFeature && (
                <div className="flex items-center gap-1.5 font-mono">
                  {(gameState.legacyUpgrades?.auto_drill_switcher || 0) >= 1 && (
                    <span className="text-[8px] px-1 bg-sky-950 border border-sky-600 text-sky-300">
                      🤖AI自動最適化
                    </span>
                  )}
                  <span className="text-sky-300">
                    AUTO:{gameState.autoActions.length}/{gameState.maxAutoSlots}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1">
              {DRILLS_DEF.filter((d) => gameState.unlocks[d.id]).map((drill) => {
                const isAuto = gameState.autoActions.includes(drill.id);
                const mRaw = gameState.mastery?.[drill.id] || 0;
                const mLv = Math.floor(mRaw / 30);
                const mPct = Math.round(((mRaw % 30) / 30) * 100);
                const flavor = drill.getAgeFlavor(gameState.age, mLv);
                const { effStam, effMent, estDelta } = getDrillEffectiveStats(gameState, drill);
                const isBannedByCh =
                  gameState.activeChallenge === 'ch_pure_body' &&
                  (drill.id === 'tactics_video' || drill.id === 'mental_image');
                const canAfford = !isBannedByCh && gameState.stamina >= effStam && gameState.mental >= effMent;

                return (
                  <div
                    key={drill.id}
                    onMouseEnter={() =>
                      setInspectorText(
                        `【${drill.cat}・習慣Lv.${mLv}】${flavor.title}（予想成長 +${
                          estDelta >= 1 ? formatNum(estDelta, 1) : estDelta.toFixed(3)
                        }）`
                      )
                    }
                    className={`border flex flex-col justify-between p-1.5 min-h-[78px] transition-colors ${
                      isBannedByCh
                        ? 'bg-slate-950/30 border-rose-900/50 opacity-45'
                        : isAuto
                          ? 'bg-sky-950/35 border-sky-500/80'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[8px] font-bold px-1 border ${drill.badgeClass}`}>{drill.cat}</span>
                      <span className="text-[8px] font-mono text-slate-400">習Lv.{mLv}</span>
                    </div>

                    <button
                      onClick={() => handleDrillClick(drill.id)}
                      disabled={!canAfford || gameState.isRetired}
                      className="text-left my-0.5 disabled:opacity-45 cursor-pointer flex-1 flex flex-col justify-center"
                    >
                      <div className="text-[9.5px] font-bold text-slate-100 leading-tight line-clamp-2">
                        {isBannedByCh ? '🔒 チャレンジ封印中' : flavor.title}
                      </div>
                      <div className="text-[8px] font-mono text-emerald-300 mt-0.5">
                        +{estDelta >= 1 ? formatNum(estDelta, 1) : estDelta.toFixed(3)} ({flavor.short})
                      </div>
                    </button>

                    <div className="space-y-0.5 pt-0.5 border-t border-slate-800/80">
                      <div className="w-full h-0.5 bg-slate-900 overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${mPct}%` }} />
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[8px] font-mono text-slate-400">
                          {effStam > 0 ? `体-${effStam}` : ''}
                          {effMent > 0 ? ` 精-${effMent}` : ''}
                        </span>
                        {gameState.unlocks.autoFeature && !isBannedByCh && (
                          <button
                            onClick={() => toggleAutoDrill(drill.id)}
                            className={`px-1 text-[8px] font-mono border cursor-pointer ${
                              isAuto
                                ? 'bg-sky-700 border-sky-400 text-white font-bold'
                                : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {isAuto ? 'ON' : 'AUTO'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 中央下段：タブ切替パネル */}
          <section className="flex-1 min-h-0 bg-slate-900 border border-slate-800 flex flex-col">
            <div className="shrink-0 flex border-b border-slate-800 bg-slate-950 text-[10px] font-bold overflow-x-auto">
              {[
                { id: 'matches', label: '⚽ 試合・戦術' },
                {
                  id: 'social',
                  // 未解放の機能名はタブに出さない（docs/GAME_DESIGN.md §21）
                  label: `🤝 交流${canProtege ? '・師弟' : ''}${canCharm ? '・お守り' : ''}`
                },
                { id: 'upgrades', label: '🛒 道具・投資・蒼空FC', show: gameState.unlocks.upgradesTab },
                { id: 'genomes', label: `🧬 ゲノム(${totalGenomeCount})`, show: totalGenomeCount > 0 },
                {
                  id: 'reincarnate',
                  label: `⏳ タイムリープ(+${formatNum(legacyGain)})`,
                  show: gameState.unlocks.reincarnateTab
                },
                { id: 'hall', label: '🏆 殿堂・ED図鑑' }
              ]
                .filter((t) => t.show !== false)
                .map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setBottomTab(tab.id)}
                    className={`px-2 py-1.5 border-r border-slate-800 whitespace-nowrap cursor-pointer ${
                      bottomTab === tab.id
                        ? 'bg-slate-900 text-amber-300 border-b-2 border-b-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 text-[10px]">
              {/* ===== TAB 1: 試合・戦術・欧州移籍・W杯 ===== */}
              {bottomTab === 'matches' && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                    <div className="bg-slate-950 border border-slate-800 p-1.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-300">所属リーグ ＆ 次の昇格ライン</span>
                        <span className="text-[8.5px] font-mono text-amber-300">
                          🌍 W杯優勝: {gameState.intlCupsWon || 0}回 (戦力+{(gameState.intlCupsWon || 0) * 5}%)
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[9.5px] font-mono tabular-nums">
                        <span className="text-amber-300 font-bold truncate">
                          {currentCat.name}（{gameState.clubName || currentCat.clubDefault}）
                        </span>
                        {nextCat ? (
                          <span className="text-slate-300 shrink-0">
                            次: <strong className="text-sky-300">{nextCat.name}</strong> (総合{formatNum(nextCat.reqRating)})
                          </span>
                        ) : (
                          <span className="text-emerald-400 shrink-0">最高峰到達</span>
                        )}
                      </div>
                      {nextCat && (
                        <div className="w-full h-1 bg-slate-900 overflow-hidden">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${Math.min(100, (rating / nextCat.reqRating) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-950 border border-slate-800 p-1.5 flex items-center justify-around text-center font-mono tabular-nums">
                      <div>
                        <div className="text-[8px] text-slate-400">勝敗</div>
                        <div className="font-bold text-slate-100">
                          {gameState.wins}勝 / {gameState.matchesPlayed}戦
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] text-slate-400">ゴール</div>
                        <div className="font-bold text-emerald-300">{gameState.goals}G</div>
                      </div>
                      <div>
                        <div className="text-[8px] text-slate-400">アシスト</div>
                        <div className="font-bold text-sky-300">{gameState.assists}A</div>
                      </div>
                      <div>
                        <div className="text-[8px] text-slate-400">MOM/カップ</div>
                        <div className="font-bold text-amber-300">
                          {gameState.momCount}/{gameState.cupsWon}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 出場ポジション（いつでも変更できる） */}
                  <div className="bg-slate-950 border border-slate-800 p-1.5 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[9px]">
                      <span className="font-bold text-sky-300">🔄 出場ポジション</span>
                      <span className="text-slate-500 text-[8.5px]">50試合でそのPOSの特性を永続習得</span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
                      {Object.values(POSITIONS).map((p) => {
                        const active = gameState.position === p.id;
                        const played = gameState.careerPosMatches?.[p.id] || 0;
                        return (
                          <button
                            key={p.id}
                            onClick={() => changePosition(p.id)}
                            title={p.name}
                            className={`p-1 border text-center ${
                              active
                                ? 'bg-sky-900 border-sky-400 text-white font-bold'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer'
                            }`}
                          >
                            <div className="text-[10px] font-bold">{p.id}</div>
                            <div className="text-[8px] font-mono opacity-80">{played}試合</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* マイ戦術スタイル（戦術熟練Lvが輪廻後も永続継承！） */}
                  <div className="bg-slate-950 border border-indigo-900/70 p-1.5 space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-bold text-indigo-300 flex items-center gap-1">
                        <Compass size={10} /> マイ戦術スタイル
                      </span>
                      <span className="text-[8px] font-mono text-slate-400">
                        現在: {TACTICAL_STYLES[gameState.tacticalStyle]?.name}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
                      {Object.values(TACTICAL_STYLES).map((ts) => {
                        const active = gameState.tacticalStyle === ts.id;
                        const banned = gameState.activeChallenge === 'ch_pure_body';
                        const mLv = Math.floor(((gameState.tacticalMastery || {})[ts.id] || 0) / 25);
                        return (
                          <button
                            key={ts.id}
                            disabled={banned}
                            onClick={() => switchTacticalStyle(ts.id)}
                            className={`p-1 border text-left ${
                              banned
                                ? 'bg-slate-900/40 border-slate-800 opacity-45 cursor-not-allowed'
                                : active
                                  ? 'bg-indigo-950/70 border-indigo-400 text-indigo-100 cursor-pointer'
                                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold text-[8.5px]">
                              <span className="truncate">{ts.name}</span>
                              <span className="font-mono text-[7.5px] text-amber-300 shrink-0">熟Lv.{mLv}</span>
                            </div>
                            <div className="text-[7.5px] text-slate-400 truncate">{ts.short}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isEuroStage && (
                    <div className="bg-indigo-950/40 border border-indigo-700 p-1.5 space-y-1">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-bold text-indigo-200 flex items-center gap-1">
                          <Globe size={10} /> 欧州4ヶ国リーグ（制覇熟練Lvは転生後も永続継承！）
                        </span>
                        <span className="font-mono text-amber-300">宿敵: {activeEuroObj.rivalName}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                        {Object.values(EURO_COUNTRIES).map((ec) => {
                          const isCur = gameState.euroCountry === ec.id;
                          const eLv = Math.floor(((gameState.euroMastery || {})[ec.id] || 0) / 10);
                          return (
                            <button
                              key={ec.id}
                              onClick={() => switchEuroCountry(ec.id)}
                              className={`p-1 border text-left cursor-pointer ${
                                isCur
                                  ? 'bg-indigo-900 border-indigo-400 text-white'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[8.5px]">
                                <span>{ec.name}</span>
                                <span className="font-mono text-[7.5px] text-amber-300">制覇Lv.{eLv}</span>
                              </div>
                              <div className="text-[7.5px] text-slate-300 truncate">{ec.perkDesc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {gameState.lastMatchReport ? (
                    <div
                      className={`border p-1.5 flex items-center justify-between text-[9.5px] tabular-nums ${
                        gameState.lastMatchReport.result === 'WIN'
                          ? 'bg-emerald-950/30 border-emerald-700/80'
                          : gameState.lastMatchReport.result === 'DRAW'
                            ? 'bg-amber-950/30 border-amber-700/80'
                            : 'bg-rose-950/30 border-rose-700/80'
                      }`}
                    >
                      <div className="font-bold">
                        最新公式戦: <span className="font-mono text-xs">{gameState.lastMatchReport.score}</span>{' '}
                        {gameState.lastMatchReport.result}
                        {gameState.lastMatchReport.isMom && (
                          <span className="ml-1 px-1 bg-amber-950 border border-amber-500 text-amber-300 text-[8px]">
                            ★MOM
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-slate-300">
                        個人 {gameState.lastMatchReport.myG}G {gameState.lastMatchReport.myA}A /{' '}
                        {gameState.lastMatchReport.note}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-800 p-1.5 text-[9px] text-slate-400">
                      公式戦は自動開催（6月・12月は宿敵と激突するカップ戦決勝！18歳以上の4年周期12月は世界W杯開催）。
                    </div>
                  )}

                  {gameState.lastHighlightLines && (
                    <div className="bg-slate-950 border border-amber-800/70 p-1.5 space-y-0.5 text-[8.5px]">
                      <div className="font-bold text-amber-300">🎙️ 直近の大一番ハイライト実況</div>
                      {gameState.lastHighlightLines.map((line, i) => (
                        <div key={i} className="text-slate-300">
                          ・{line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ===== TAB 2: 交流・師弟・恋愛（既婚後は恋愛欄非表示！）・子ども情報・お守り ===== */}
              {bottomTab === 'social' && (
                <div className="space-y-1.5">
                  {canProtege && (
                    <div className="bg-sky-950/30 border border-sky-700/80 p-1.5 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-[9px] font-bold text-sky-300 flex items-center gap-1">
                          <GraduationCap size={11} /> 次世代「師弟継承」（この人生で育てられるのは1人だけ・全4人絆Lv.5図鑑コンプで全上限+18）
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[8.5px] text-amber-300">
                            図鑑コンプ: {protegeCompCount}/4人
                          </span>
                          {activeProtegeObj && (
                            <button
                              onClick={trainProtege}
                              disabled={
                                isSocialDisabledByCh ||
                                gameState.tactics < 20 ||
                                gameState.stamina < 10 ||
                                gameState.lastProtegeMonth === gameState.age * 12 + gameState.month
                              }
                              className="px-2 py-0.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-45 text-white font-bold text-[8.5px] cursor-pointer"
                            >
                              {gameState.lastProtegeMonth === gameState.age * 12 + gameState.month
                                ? '今月は特訓済み'
                                : '🔥 合同特訓 (20Pt/体-10)'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
                        {Object.values(PROTEGE_ARCHETYPES).map((arch) => {
                          const isSelected = gameState.protege?.archetypeId === arch.id;
                          // この人生ですでに誰かを指名していたら、他の子は選べない
                          const locked = Boolean(gameState.protege?.archetypeId) && !isSelected;
                          const bestLv = gameState.protegeBonds?.[arch.id] || 0;
                          const isComp = bestLv >= 5;
                          const nowLv = isSelected ? gameState.protege?.bondLv || 1 : 0;
                          return (
                            <button
                              key={arch.id}
                              onClick={() => selectProtege(arch.id)}
                              disabled={locked}
                              className={`p-1 border text-left ${
                                locked
                                  ? 'bg-slate-950/60 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-sky-900 border-sky-300 text-white cursor-default'
                                    : isComp
                                      ? 'bg-amber-950/35 border-amber-500/80 text-amber-100 cursor-pointer'
                                      : 'bg-slate-950 hover:bg-slate-800 border-sky-800/70 text-sky-200 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[8.5px]">
                                <span>
                                  {arch.name} [{arch.pos}]
                                </span>
                                <span className="font-mono text-[7.5px] text-amber-300">
                                  {isSelected ? `絆Lv.${nowLv}` : isComp ? `★最高${bestLv}` : bestLv > 0 ? `最高${bestLv}` : '未育成'}
                                </span>
                              </div>
                              <div className="text-[7.5px] text-slate-300 truncate">{arch.perkText}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 特別アクション */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-slate-300">
                      特別アクション（今世の人間関係・実績はタイムリープ時にリセット）
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      <button
                        onClick={challengeRival}
                        disabled={gameState.stamina < 12 || gameState.mental < 10}
                        className="bg-slate-950 hover:bg-rose-950/30 disabled:opacity-45 border border-rose-800/80 p-1.5 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-[9.5px] font-bold text-rose-300">
                          <span>⚔️ 宿敵 {activeRivalName} に挑む</span>
                          <span className="font-mono text-[8px]">体-12 精-10</span>
                        </div>
                        <div className="text-[8.5px] text-slate-400 mt-0.5">
                          5勝で共闘タッグ解放・ユニフォーム獲得（今世{gameState.rival?.winsAgainst || 0}勝）
                        </div>
                      </button>

                      <button
                        onClick={doCoachLesson}
                        disabled={isSocialDisabledByCh || gameState.tactics < 25 || gameState.mental < 8}
                        className="bg-slate-950 hover:bg-sky-950/30 disabled:opacity-45 border border-sky-800/80 p-1.5 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-[9.5px] font-bold text-sky-300">
                          <span>📋 恩師コーチ個別指導</span>
                          <span className="font-mono text-[8px]">25Pt 精-8</span>
                        </div>
                        <div className="text-[8.5px] text-slate-400 mt-0.5">
                          戦術・技術即上昇＆信頼Lv.{gameState.relations?.coachTrust || 1}（Lv.4で手帳獲得）
                        </div>
                      </button>

                      <button
                        onClick={doTeamDinner}
                        disabled={isSocialDisabledByCh || gameState.money < 4000 || gameState.stamina < 8}
                        className="bg-slate-950 hover:bg-emerald-950/30 disabled:opacity-45 border border-emerald-800/80 p-1.5 text-left cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-[9.5px] font-bold text-emerald-300">
                          <span>🤝 同僚と紅白戦＆飯会</span>
                          <span className="font-mono text-[8px]">4,000円 体-8</span>
                        </div>
                        <div className="text-[8.5px] text-slate-400 mt-0.5">
                          連携Lv.{gameState.relations?.teamChem || 1}上昇でチーム全体の試合戦力底上げ
                        </div>
                      </button>

                      {gameState.age >= 15 && !gameState.life.married && (
                        <button
                          onClick={() => doRomanceEvent(null)}
                          disabled={
                            isSocialDisabledByCh ||
                            gameState.money < 5000 ||
                            gameState.mental < 8 ||
                            gameState.lastRomanceMonth === gameState.age * 12 + gameState.month ||
                            (gameState.life.affection || 0) >= AFFECTION_MAX
                          }
                          className="bg-slate-950 hover:bg-pink-950/30 disabled:opacity-45 border border-pink-800/80 p-1.5 text-left cursor-pointer"
                        >
                          <div className="flex items-center justify-between text-[9.5px] font-bold text-pink-300">
                            <span>
                              💕 現在の相手と過ごす（親密度 {gameState.life.affection || 0}/{AFFECTION_MAX}）
                            </span>
                            <span className="font-mono text-[8px]">5,000円 精-8</span>
                          </div>
                          <div className="text-[8.5px] text-slate-400 mt-0.5">
                            {gameState.lastRomanceMonth === gameState.age * 12 + gameState.month
                              ? '今月はもう会った（月に1回まで）'
                              : `月1回まで。20/40/60/80/${AFFECTION_MAX} で出来事が起きる。${AFFECTION_MARRY}＆18歳以上で結婚`}
                          </div>
                        </button>
                      )}

                      {gameState.age >= 16 && gameState.categoryId >= MEDIA_MIN_CAT && (
                        <button
                          onClick={doMediaAppeal}
                          disabled={isSocialDisabledByCh || gameState.mental < 12}
                          className="bg-slate-950 hover:bg-amber-950/30 disabled:opacity-45 border border-amber-800/80 p-1.5 text-left cursor-pointer"
                        >
                          <div className="flex items-center justify-between text-[9.5px] font-bold text-amber-300">
                            <span>📺 メディア・代表アピール</span>
                            <span className="font-mono text-[8px]">精-12</span>
                          </div>
                          <div className="text-[8.5px] text-slate-400 mt-0.5">
                            ファン＆出演料を一気に獲得（出演歴は転生リセット）
                          </div>
                        </button>
                      )}
                    </div>

                    {gameState.age >= 15 &&
                      (gameState.life.married ? (
                        <div className="bg-pink-950/25 border border-pink-700/70 p-1.5 text-[9px] flex flex-wrap items-center justify-between gap-1">
                          <span className="font-bold text-pink-200">
                            💍 既婚：{PARTNER_TYPES[gameState.life.partnerType]?.name || '愛する妻'}と一途な家庭生活（図鑑コンプ {partnerCompCount}/4人）
                          </span>
                          <span className="text-amber-200 font-mono text-[8.5px]">
                            {gameState.life.childActive
                              ? `⚽ ${gameState.life.childGender === 'daughter' ? '娘' : '息子'}(${gameState.life.childTalent})と共にプロ出場中！`
                              : gameState.life.hasChild
                                ? '👶 第一子成長中（24歳で自動サッカーデビュー！）'
                                : '20歳以降に時間経過で第一子誕生'}
                          </span>
                        </div>
                      ) : (
                        <div className="bg-slate-950 border border-pink-900/60 p-1.5 space-y-1 text-[9px]">
                          <div className="flex items-center justify-between">
                            <span className="text-pink-300 font-bold flex items-center gap-1">
                              <Heart size={10} /> 恋愛パートナー選択（自分の属性・実績で解放 / 全4人結婚コンプ）
                            </span>
                            <span className="font-mono text-amber-300">結婚コンプ: {partnerCompCount}/4人</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1">
                            {Object.values(PARTNER_TYPES).map((pt) => {
                              const unlocked = pt.checkUnlock(gameState, rating);
                              const isCurrent = gameState.life.partnerType === pt.id;
                              const rec = gameState.partnerRecords?.[pt.id] || { maxAff: 0, married: false };
                              return (
                                <button
                                  key={pt.id}
                                  onClick={() => doRomanceEvent(pt.id)}
                                  disabled={!unlocked || isSocialDisabledByCh || gameState.money < 5000 || gameState.mental < 8}
                                  className={`p-1 border text-left ${
                                    !unlocked
                                      ? 'bg-slate-900/40 border-slate-800 opacity-50 cursor-not-allowed'
                                      : isCurrent
                                        ? 'bg-pink-950/70 border-pink-400 text-pink-100 cursor-pointer'
                                        : rec.married
                                          ? 'bg-amber-950/30 border-amber-500/70 text-amber-100 cursor-pointer'
                                          : 'bg-slate-900 hover:bg-pink-950/40 border-pink-800/70 text-pink-200 cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-center justify-between font-bold text-[8.5px]">
                                    <span className="truncate">{unlocked ? pt.name : '🔒 未解放ヒロイン'}</span>
                                    <span className="font-mono text-[7.5px] text-amber-300 shrink-0">
                                      {rec.married ? '💍既婚歴' : unlocked ? `愛${rec.maxAff}` : ''}
                                    </span>
                                  </div>
                                  <div className="text-[7.5px] text-slate-300 truncate">
                                    {unlocked ? pt.perk : pt.reqText}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* ハイブリッド特性スロット */}
                  {canTrait && (
                  <div className="space-y-1 pt-1 border-t border-slate-800">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-bold text-emerald-300">
                        🎭 ハイブリッド特性（装備:{gameState.equippedTraits?.length || 0}/{gameState.maxTraitSlots || 2}枠）
                      </span>
                      <span className="font-mono text-slate-400">
                        習得済:{gameState.unlockedTraits?.length || 0}/7
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1">
                      {POSITION_TRAITS_DEF.map((tr) => {
                        const unlocked = gameState.unlockedTraits?.includes(tr.id);
                        const equipped = gameState.equippedTraits?.includes(tr.id);
                        const curM = gameState.careerPosMatches?.[tr.pos] || 0;
                        return (
                          <button
                            key={tr.id}
                            onClick={() => toggleEquipTrait(tr.id)}
                            disabled={!unlocked}
                            className={`p-1 border text-left ${
                              equipped
                                ? 'bg-emerald-950/60 border-emerald-400 text-emerald-100 cursor-pointer'
                                : unlocked
                                  ? 'bg-slate-950 border-slate-700 text-slate-200 hover:border-emerald-500 cursor-pointer'
                                  : 'bg-slate-950/40 border-slate-800/60 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold text-[8.5px]">
                              <span className="truncate">{tr.name}</span>
                              <span className="font-mono text-[7.5px] shrink-0">
                                {equipped ? '★装備' : unlocked ? '習得' : `${Math.min(50, curM)}/50戦`}
                              </span>
                            </div>
                            <div className="text-[7.5px] text-slate-300 truncate">{tr.effect}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {/* 絆のお守り */}
                  {canCharm && (
                  <div className="space-y-1 pt-1 border-t border-slate-800">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-bold text-amber-300">
                        <Award size={10} className="inline mr-0.5" /> 絆のお守り（装備中: {gameState.equippedCharms.length}/
                        {gameState.maxCharmSlots}枠）
                      </span>
                      <span className="font-mono text-slate-400">獲得済: {gameState.unlockedCharms.length}/6</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      {CHARMS_DEF.map((ch) => {
                        const unlocked = gameState.unlockedCharms.includes(ch.id);
                        const equipped = gameState.equippedCharms.includes(ch.id);
                        return (
                          <button
                            key={ch.id}
                            onClick={() => toggleEquipCharm(ch.id)}
                            disabled={!unlocked}
                            className={`p-1.5 border text-left ${
                              equipped
                                ? 'bg-amber-950/50 border-amber-400 text-amber-100 cursor-pointer'
                                : unlocked
                                  ? 'bg-slate-950 border-slate-700 text-slate-200 hover:border-amber-600 cursor-pointer'
                                  : 'bg-slate-950/40 border-slate-800/60 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold text-[9px]">
                              <span className="truncate">{unlocked ? ch.name : `🔒 ${ch.source}`}</span>
                              <span className="font-mono text-[8px] shrink-0">
                                {equipped ? '★装備中' : unlocked ? '装備可' : '未獲得'}
                              </span>
                            </div>
                            <div className="text-[8px] text-slate-300 truncate mt-0.5">
                              {unlocked ? ch.effect : `獲得条件: ${ch.source}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
              )}

              {/* ===== TAB 3: 投資・蒼空FC・永続知識（「未コンプのみ表示」フィルタ＆MAX一括対応！） ===== */}
              {bottomTab === 'upgrades' && (
                <div className="space-y-1.5">
                  <div className="bg-slate-950 border border-slate-800 px-1.5 py-1 flex flex-wrap items-center justify-between gap-1 text-[9px]">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setInvestSubTab('gear')}
                        className={`px-2 py-0.5 border font-bold cursor-pointer ${
                          investSubTab === 'gear'
                            ? 'bg-sky-900 border-sky-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        🛒 道具・財団(今世)
                      </button>
                      <button
                        onClick={() => setInvestSubTab('breakthrough')}
                        className={`px-2 py-0.5 border font-bold cursor-pointer ${
                          investSubTab === 'breakthrough'
                            ? 'bg-amber-900 border-amber-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        ⚡ 永続ブレイクスルー
                      </button>
                      {canHobby && (
                        <button
                          onClick={() => setInvestSubTab('club_hobby')}
                          className={`px-2 py-0.5 border font-bold cursor-pointer ${
                            investSubTab === 'club_hobby'
                              ? 'bg-emerald-900 border-emerald-400 text-white'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          🏟️ 蒼空FC・永続知識・予知
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 font-mono">
                      <label className="flex items-center gap-0.5 text-[8.5px] text-amber-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hideCompleted}
                          onChange={(e) =>
                            setGameState((p) => ({
                              ...p,
                              qolToggles: { ...p.qolToggles, hideCompleted: e.target.checked }
                            }))
                          }
                          className="accent-amber-400"
                        />
                        未コンプのみ
                      </label>
                      {(gameState.legacyUpgrades?.auto_gear_agent || 0) >= 1 && (
                        <label className="flex items-center gap-0.5 text-[8.5px] text-sky-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={gameState.qolToggles?.autoGearBuy !== false}
                            onChange={(e) =>
                              setGameState((p) => ({
                                ...p,
                                qolToggles: { ...p.qolToggles, autoGearBuy: e.target.checked }
                              }))
                            }
                            className="accent-sky-400"
                          />
                          自動購入
                        </label>
                      )}
                      {[1, 10, 'max'].map((amt) => (
                        <button
                          key={String(amt)}
                          onClick={() => setBuyAmount(amt)}
                          className={`px-1.5 py-0.5 border cursor-pointer ${
                            buyAmount === amt
                              ? 'bg-sky-900 border-sky-400 text-white font-bold'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {amt === 'max' ? 'MAX' : `${amt}x`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {investSubTab === 'gear' && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                        {UPGRADES_DEF.filter((u) => {
                          if (u.minAge && gameState.age < u.minAge) return false;
                          if (u.minCat && gameState.categoryId < u.minCat) return false;
                          if (u.minFans && (gameState.fans || 0) < u.minFans) return false;
                          const curLv = gameState.upgrades?.[u.id] || 0;
                          if (hideCompleted && curLv >= u.maxLv) return false;
                          return true;
                        }).map((upg) => {
                          const curLv = gameState.upgrades?.[upg.id] || 0;
                          const isMax = curLv >= upg.maxLv;
                          const calc = calcBulkPurchase(
                            curLv,
                            upg.maxLv,
                            buyAmount,
                            gameState.money,
                            gameState.tactics,
                            upg.baseG,
                            upg.basePt,
                            upg.growth
                          );
                          const singleG = Math.floor(upg.baseG * Math.pow(upg.growth, curLv));
                          const singlePt = Math.floor(upg.basePt * Math.pow(upg.growth, curLv));
                          const canAfford = !isGearDisabledByCh && !isMax && calc.count > 0;

                          return (
                            <button
                              key={upg.id}
                              onMouseEnter={() => setInspectorText(`🛒 ${upg.name}：${upg.desc}`)}
                              onClick={() => buyUpgrade(upg)}
                              disabled={!canAfford}
                              className={`p-1.5 border text-left flex flex-col justify-between ${
                                isMax
                                  ? 'bg-slate-900/50 border-slate-800 opacity-60'
                                  : canAfford
                                    ? 'bg-slate-950 hover:bg-slate-800 border-slate-700 cursor-pointer'
                                    : 'bg-slate-950/40 border-slate-800/70 opacity-45 cursor-not-allowed'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold text-[9.5px] text-slate-100 truncate">{upg.name}</span>
                                <span className="font-mono text-[8.5px] text-slate-400 shrink-0">
                                  Lv.{curLv}/{upg.maxLv}
                                </span>
                              </div>
                              <div className="text-[8px] text-sky-300 truncate my-0.5">{upg.short}</div>
                              <div className="text-[8.5px] font-mono text-amber-300">
                                {isGearDisabledByCh
                                  ? '🔒 縛りチャレンジ禁止中'
                                  : isMax
                                    ? 'MAX完了'
                                    : calc.count > 1
                                      ? `+${calc.count}Lv (${formatYen(calc.totalG)}${
                                          calc.totalPt > 0 ? `/${formatNum(calc.totalPt)}Pt` : ''
                                        })`
                                      : `${formatYen(singleG)}${singlePt > 0 ? ` / ${formatNum(singlePt)}Pt` : ''}`}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {canGear && (
                        <div className="bg-slate-950 border border-slate-800 p-1.5 space-y-1">
                          <div className="text-[9px] font-bold text-slate-300">
                            🏛️ 無制限投資
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                            {[
                              {
                                id: 'endless_lab',
                                name: '青空スポーツ科学研究所',
                                desc: '全能力上限 +0.35/Lv',
                                baseG: 40000,
                                basePt: 140
                              },
                              {
                                id: 'endless_ai',
                                name: 'AI戦術解析スーパーコンピュータ',
                                desc: '全能力成長 +2.5% & 閃き+0.3%/Lv',
                                baseG: 50000,
                                basePt: 180
                              },
                              {
                                id: 'endless_fund',
                                name: '青空グローバル育成基金',
                                desc: '全試合戦力 +2%/Lv',
                                baseG: 65000,
                                basePt: 220
                              }
                            ].map((item) => {
                              const lv = gameState.endlessInvest?.[item.id] || 0;
                              const calc = calcBulkPurchase(
                                lv,
                                999,
                                buyAmount,
                                gameState.money,
                                gameState.tactics,
                                item.baseG,
                                item.basePt,
                                1.38
                              );
                              const singleG = Math.floor(item.baseG * Math.pow(1.38, lv));
                              const singlePt = Math.floor(item.basePt * Math.pow(1.38, lv));
                              const ok = calc.count > 0;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => buyEndlessInvest(item.id, item.name, item.baseG, item.basePt)}
                                  disabled={!ok}
                                  className={`p-1 border text-left ${
                                    ok
                                      ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 cursor-pointer'
                                      : 'bg-slate-950/40 border-slate-800 opacity-45 cursor-not-allowed'
                                  }`}
                                >
                                  <div className="flex items-center justify-between font-bold text-[8.5px] text-slate-200">
                                    <span className="truncate">{item.name}</span>
                                    <span className="font-mono text-amber-300">Lv.{lv}</span>
                                  </div>
                                  <div className="text-[7.5px] text-sky-300">{item.desc}</div>
                                  <div className="text-[8px] font-mono text-amber-200">
                                    {calc.count > 1
                                      ? `+${calc.count}Lv (${formatYen(calc.totalG)}/${formatNum(calc.totalPt)}Pt)`
                                      : `${formatYen(singleG)} / ${formatNum(singlePt)}Pt`}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {investSubTab === 'breakthrough' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      {BREAKTHROUGHS_DEF.filter((bt) => !hideCompleted || !gameState.breakthroughs?.[bt.id]).map((bt) => {
                        const unlocked = Boolean(gameState.breakthroughs?.[bt.id]);
                        const canAfford =
                          !isBtDisabledByCh &&
                          !unlocked &&
                          gameState.money >= bt.costMoney &&
                          gameState.tactics >= bt.costTactics;
                        return (
                          <button
                            key={bt.id}
                            onMouseEnter={() => setInspectorText(`⚡ ${bt.name}：${bt.desc}`)}
                            onClick={() => buyBreakthrough(bt)}
                            disabled={!canAfford}
                            className={`p-1.5 border text-left flex flex-col justify-between ${
                              unlocked
                                ? 'bg-amber-950/35 border-amber-500/80 text-amber-100'
                                : canAfford
                                  ? 'bg-slate-950 hover:bg-amber-950/30 border-amber-600/80 cursor-pointer'
                                  : 'bg-slate-950/40 border-slate-800 opacity-45 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-[9.5px] text-amber-200 truncate">{bt.name}</span>
                              <span className="text-[7.5px] px-1 bg-amber-950 border border-amber-700 text-amber-300 shrink-0">
                                {bt.tag}
                              </span>
                            </div>
                            <div className="text-[8px] text-slate-200 my-0.5">{bt.short}</div>
                            <div className="text-[8.5px] font-mono font-bold text-amber-300">
                              {isBtDisabledByCh
                                ? '🔒 チャレンジ封印中'
                                : unlocked
                                  ? '✅ 永続解放済み'
                                  : `${formatYen(bt.costMoney)} / ${formatNum(bt.costTactics)}Pt`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {investSubTab === 'club_hobby' && canHobby && (
                    <div className="space-y-1.5">
                      {gameState.categoryId >= 12 ? (
                      <div className="bg-emerald-950/25 border border-emerald-700/80 p-1.5 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-bold text-[9.5px] text-emerald-300 flex items-center gap-1">
                            <Shield size={11} /> 地元クラブ「{gameState.homeClubName || '蒼空FC'}」運営（同僚Lv3で連携共鳴）
                          </span>
                          {(() => {
                            const cLv = gameState.localClubLv || 1;
                            let allowedMax = 1;
                            for (let lv = 2; lv <= 7; lv++) {
                              if ((gameState.categoryId || 0) >= LOCAL_CLUB_REQ_CAT[lv]) allowedMax = lv;
                            }
                            const isMax = cLv >= 7;
                            const isCatLocked = !isMax && cLv >= allowedMax;
                            const calc = calcBulkPurchase(
                              cLv,
                              allowedMax,
                              buyAmount,
                              gameState.money,
                              gameState.tactics,
                              35000,
                              140,
                              2.25
                            );
                            const singleG = Math.floor(35000 * Math.pow(2.25, cLv));
                            const singlePt = Math.floor(140 * Math.pow(2.25, cLv));
                            return (
                              <button
                                onClick={upgradeLocalClubTier}
                                disabled={isSoloDisabledByCh || isMax || isCatLocked || calc.count === 0}
                                className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-45 text-white font-mono text-[8.5px] font-bold cursor-pointer"
                              >
                                {isMax
                                  ? '世界王者クラブMAX'
                                  : isCatLocked
                                  ? `${CATEGORIES[LOCAL_CLUB_REQ_CAT[cLv + 1]].name}到達で昇格可`
                                  : calc.count > 1
                                    ? `クラブ昇格 +${calc.count}Lv (${formatYen(calc.totalG)}/${formatNum(calc.totalPt)}Pt)`
                                    : `クラブ昇格 Lv.${cLv}→${cLv + 1} (${formatYen(singleG)}/${formatNum(singlePt)}Pt)`}
                              </button>
                            );
                          })()}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
                          {LOCAL_CLUB_MATES.filter((m) => !hideCompleted || (gameState.clubMates?.[m.id] || 1) < m.maxLv).map((m) => {
                            const mLv = gameState.clubMates?.[m.id] || 1;
                            const isMax = mLv >= m.maxLv;
                            const calc = calcBulkPurchase(
                              mLv,
                              m.maxLv,
                              buyAmount,
                              gameState.money,
                              gameState.tactics,
                              m.baseG,
                              m.basePt,
                              m.growth
                            );
                            const singleG = Math.floor(m.baseG * Math.pow(m.growth, mLv));
                            const singlePt = Math.floor(m.basePt * Math.pow(m.growth, mLv));
                            const ok = !isSoloDisabledByCh && !isMax && calc.count > 0;
                            return (
                              <button
                                key={m.id}
                                onClick={() => investClubMate(m)}
                                disabled={!ok}
                                className={`p-1 border text-left ${
                                  ok
                                    ? 'bg-slate-950 hover:bg-slate-800 border-emerald-800/80 cursor-pointer'
                                    : 'bg-slate-950/40 border-slate-800 opacity-45 cursor-not-allowed'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold text-[8.5px] text-emerald-200">
                                  <span>
                                    {m.name}[{m.pos}]
                                  </span>
                                  <span className="font-mono text-amber-300">Lv.{mLv}</span>
                                </div>
                                <div className="text-[7.5px] text-slate-300 truncate">{m.short}</div>
                                <div className="text-[7.5px] font-mono text-amber-200">
                                  {isMax
                                    ? 'MAX'
                                    : calc.count > 1
                                      ? `+${calc.count}Lv (${formatYen(calc.totalG)})`
                                      : `${formatYen(singleG)}/${formatNum(singlePt)}Pt`}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
                          {LOCAL_CLUB_FACILITIES.filter(
                            (f) => !hideCompleted || (gameState.clubFacilities?.[f.id] || 0) < f.maxLv
                          ).map((f) => {
                            const fLv = gameState.clubFacilities?.[f.id] || 0;
                            const isMax = fLv >= f.maxLv;
                            const calc = calcBulkPurchase(
                              fLv,
                              f.maxLv,
                              buyAmount,
                              gameState.money,
                              gameState.tactics,
                              f.baseG,
                              f.basePt,
                              f.growth
                            );
                            const singleG = Math.floor(f.baseG * Math.pow(f.growth, fLv));
                            const singlePt = Math.floor(f.basePt * Math.pow(f.growth, fLv));
                            const ok = !isSoloDisabledByCh && !isMax && calc.count > 0;
                            return (
                              <button
                                key={f.id}
                                onClick={() => investClubFacility(f)}
                                disabled={!ok}
                                className={`p-1 border text-left ${
                                  ok
                                    ? 'bg-slate-950 hover:bg-slate-800 border-sky-800/70 cursor-pointer'
                                    : 'bg-slate-950/40 border-slate-800 opacity-45 cursor-not-allowed'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold text-[8.5px] text-sky-200">
                                  <span className="truncate">{f.name}</span>
                                  <span className="font-mono text-amber-300 shrink-0">Lv.{fLv}</span>
                                </div>
                                <div className="text-[7.5px] text-slate-300 truncate">{f.short}</div>
                                <div className="text-[7.5px] font-mono text-amber-200">
                                  {isMax
                                    ? 'MAX'
                                    : calc.count > 1
                                      ? `+${calc.count}Lv (${formatYen(calc.totalG)})`
                                      : `${formatYen(singleG)}/${formatNum(singlePt)}Pt`}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      ) : (
                        <div className="bg-slate-950 border border-dashed border-slate-700 p-2 text-[9.5px] text-slate-400">
                          🔒 <strong className="text-slate-300">地元クラブ「蒼空FC」への出資</strong>は、
                          海外のクラブで稼げるようになってから解放される（欧州中堅リーグ到達）。
                          <div className="text-[8.5px] text-slate-500 mt-0.5">
                            子どものうちから地元クラブに資金を出して育成することはできない。
                          </div>
                        </div>
                      )}

                      {/* 永続知識・趣味＆未来予知記憶 */}
                      <div className="bg-slate-950 border border-slate-800 p-1.5 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[9px]">
                          <span className="font-bold text-amber-300">
                            🧠 頭の中の知識・趣味
                          </span>
                          <div className="flex items-center gap-1">
                            {(() => {
                              const pLv = gameState.prophecyLv || 0;
                              const calc = calcBulkPurchase(
                                pLv,
                                20,
                                buyAmount,
                                gameState.money,
                                gameState.tactics,
                                22000,
                                120,
                                1.82
                              );
                              return (
                                <button
                                  onClick={upgradeProphecyMemory}
                                  disabled={pLv >= 20 || calc.count === 0}
                                  className="px-1.5 py-0.5 bg-amber-900/70 hover:bg-amber-800 disabled:opacity-45 border border-amber-500 text-amber-200 text-[8px] font-mono cursor-pointer"
                                >
                                  🐎 未来予知・競馬記憶 Lv.{pLv}/20{' '}
                                  {pLv >= 20
                                    ? '(MAX)'
                                    : calc.count > 1
                                      ? `(+${calc.count}Lv: ${formatYen(calc.totalG)})`
                                      : `(${formatYen(Math.floor(22000 * Math.pow(1.82, pLv)))})`}
                                </button>
                              );
                            })()}
                            {(() => {
                              const maxAff = Math.min(
                                Math.floor((gameState.fans || 0) / 400),
                                Math.floor(gameState.money / 15000)
                              );
                              const cnt = buyAmount === 'max' ? maxAff : Math.min(buyAmount, maxAff);
                              return (
                                <button
                                  onClick={executeFanSchoolTour}
                                  disabled={cnt <= 0}
                                  className="px-1.5 py-0.5 bg-emerald-900/70 hover:bg-emerald-800 disabled:opacity-45 border border-emerald-500 text-emerald-200 text-[8px] font-mono cursor-pointer"
                                >
                                  🎪 スクール巡業 {cnt > 1 ? `×${cnt}回` : '(400ファン/1.5万円)'}
                                </button>
                              );
                            })()}
                            {(() => {
                              const bLv = gameState.brandProjects?.sig_brand || 0;
                              const calc = calcBulkPurchase(
                                bLv,
                                30,
                                buyAmount,
                                gameState.fans || 0,
                                gameState.money,
                                1500,
                                35000,
                                1.65
                              );
                              return (
                                <button
                                  onClick={buySignatureBrand}
                                  disabled={bLv >= 30 || calc.count === 0}
                                  className="px-1.5 py-0.5 bg-purple-900/70 hover:bg-purple-800 disabled:opacity-45 border border-purple-500 text-purple-200 text-[8px] font-mono cursor-pointer"
                                >
                                  👟 ブランド Lv.{bLv} {calc.count > 1 ? `(+${calc.count}Lv)` : '(1,500ファン)'}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
                          {HOBBIES_DEF.filter((h) => !hideCompleted || (gameState.hobbies?.[h.id] || 0) < h.maxLv).map((hb) => {
                            const hLv = gameState.hobbies?.[hb.id] || 0;
                            const isMax = hLv >= hb.maxLv;
                            const lockedByAge = gameState.age < hb.minAge && hLv === 0;
                            const calc = calcBulkPurchase(
                              hLv,
                              hb.maxLv,
                              buyAmount,
                              gameState.money,
                              gameState.tactics,
                              hb.baseG,
                              hb.basePt,
                              hb.growth
                            );
                            const singleG = Math.floor(hb.baseG * Math.pow(hb.growth, hLv));
                            const singlePt = Math.floor(hb.basePt * Math.pow(hb.growth, hLv));
                            const ok = !lockedByAge && !isMax && calc.count > 0;
                            return (
                              <button
                                key={hb.id}
                                onClick={() => buyHobby(hb)}
                                disabled={!ok}
                                className={`p-1 border text-left ${
                                  isMax
                                    ? 'bg-amber-950/30 border-amber-600/70 text-amber-200'
                                    : ok
                                      ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 cursor-pointer'
                                      : 'bg-slate-950/40 border-slate-800 opacity-45 cursor-not-allowed'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold text-[8.5px]">
                                  <span className="truncate">{hb.name}</span>
                                  <span className="font-mono text-amber-300 shrink-0">
                                    Lv.{hLv}/{hb.maxLv}
                                  </span>
                                </div>
                                <div className="text-[7.5px] text-slate-300 truncate">{hb.short}</div>
                                <div className="text-[7.5px] font-mono text-amber-200">
                                  {lockedByAge
                                    ? `🔒 ${hb.minAge}歳〜`
                                    : isMax
                                      ? '★極み永続'
                                      : calc.count > 1
                                        ? `+${calc.count}Lv (${formatYen(calc.totalG)})`
                                        : `${formatYen(singleG)}/${formatNum(singlePt)}Pt`}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ===== TAB 4: ゲノム（体格ゲノムコンプ状況表示＆未コンプ育成中 vs アーカイブ整理） ===== */}
              {bottomTab === 'genomes' && (
                <div className="space-y-1.5">
                  <div className="bg-slate-950 border border-sky-800/70 p-1.5 flex flex-wrap items-center justify-between gap-2 text-[8.5px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sky-300">
                        🏃 体格ゲノムコンプ: {bodyGenomesMasteredCount}/4種
                      </span>
                      {bodyGenomesList.map((bg) => {
                        const lv = gameState.genomes?.[bg.id] || 0;
                        return (
                          <span
                            key={bg.id}
                            className={`px-1 border font-mono text-[7.5px] ${
                              lv >= 5
                                ? 'bg-amber-950 border-amber-500 text-amber-200 font-bold'
                                : 'bg-slate-900 border-slate-700 text-slate-300'
                            }`}
                          >
                            {bg.name.replace('【体格】', '').replace('遺伝子', '')} Lv.{lv}/5
                          </span>
                        );
                      })}
                    </div>

                    <label
                      className="flex items-center gap-1 text-emerald-300 font-bold cursor-pointer"
                      title="進路選択の全選択肢がゲノムLv.5完了済みの場合のみ、最上位進路を自動選択します（未コンプがある場合は必ず手動選択）"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(gameState.qolToggles?.autoCareerPath)}
                        onChange={(e) =>
                          setGameState((p) => ({
                            ...p,
                            qolToggles: { ...p.qolToggles, autoCareerPath: e.target.checked }
                          }))
                        }
                        className="accent-emerald-400"
                      />
                      全進路コンプ済みなら自動進学
                    </label>
                  </div>

                  {top3ClosestGenomes.length > 0 && (
                    <div className="bg-slate-950 border border-amber-800/60 p-1.5 space-y-1">
                      <div className="text-[8.5px] font-bold text-amber-300 flex items-center gap-1">
                        <TrendingUp size={10} /> 次に覚醒間近の遺伝子 TOP3
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                        {top3ClosestGenomes.map(({ def, curLv, val, nextTarget, pct }) => (
                          <div key={def.id} className="bg-slate-900 border border-slate-800 px-1.5 py-1">
                            <div className="flex items-center justify-between text-[8.5px] font-bold text-slate-200">
                              <span className="truncate">{def.name}</span>
                              <span className="font-mono text-amber-300 shrink-0">→Lv.{curLv + 1}</span>
                            </div>
                            <div className="w-full h-1 bg-slate-950 my-0.5 overflow-hidden">
                              <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-[7.5px] font-mono text-slate-400 flex justify-between">
                              <span className="truncate">{def.condition}</span>
                              <span className="shrink-0">
                                {formatNum(val)}/{formatNum(nextTarget)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-1 bg-slate-950 border border-slate-800 p-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setGenomeSubTab('active')}
                        className={`px-2 py-0.5 text-[9px] font-bold border cursor-pointer ${
                          genomeSubTab === 'active'
                            ? 'bg-amber-900/70 border-amber-400 text-amber-200'
                            : 'bg-slate-900 border-slate-700 text-slate-400'
                        }`}
                      >
                        🧬 育成中遺伝子 ({activeBaseGenomes.length})
                      </button>
                      <button
                        onClick={() => setGenomeSubTab('fused')}
                        className={`px-2 py-0.5 text-[9px] font-bold border cursor-pointer ${
                          genomeSubTab === 'fused'
                            ? 'bg-purple-900/70 border-purple-400 text-purple-200'
                            : 'bg-slate-900 border-slate-700 text-slate-400'
                        }`}
                      >
                        🌌 融合・隠し・共鳴
                      </button>
                      <button
                        onClick={() => setGenomeSubTab('archive')}
                        className={`px-2 py-0.5 text-[9px] font-bold border cursor-pointer ${
                          genomeSubTab === 'archive'
                            ? 'bg-slate-800 border-slate-500 text-slate-200'
                            : 'bg-slate-900 border-slate-700 text-slate-400'
                        }`}
                      >
                        📦 完了・アーカイブ ({archivedBaseGenomes.length})
                      </button>
                    </div>
                    <span className="text-[8.5px] text-slate-400 hidden sm:inline">
                      全7POS熟練: {Object.keys(POSITIONS).map((p) => `${p}:${gameState.careerPosMatches?.[p] || 0}`).join(' ')}
                    </span>
                  </div>

                  {genomeSubTab === 'active' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      {activeBaseGenomes.map((def) => {
                        const curLv = gameState.genomes?.[def.id] || 0;
                        const val = def.getStatVal(gameState);
                        const isMax = !def.isPathGenome && curLv >= def.maxLv;
                        const nextTarget = (curLv + 1) * def.step;
                        const prevBase = curLv * def.step;
                        const pct = isMax
                          ? 100
                          : Math.min(100, Math.max(0, ((val - prevBase) / Math.max(1, nextTarget - prevBase)) * 100));

                        return (
                          <div
                            key={def.id}
                            className={`p-1.5 border ${
                              curLv > 0 ? 'bg-amber-950/20 border-amber-700/70' : 'bg-slate-950 border-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold text-[9.5px]">
                              <span className={curLv > 0 ? 'text-amber-300' : 'text-slate-300'}>{def.name}</span>
                              <span className="font-mono text-[8.5px] text-slate-300">
                                {def.isPathGenome ? `Lv.${curLv} (Lv.5で収納)` : `Lv.${curLv}/${def.maxLv}`}
                              </span>
                            </div>
                            <div className="text-[8px] text-slate-400 mt-0.5">
                              {def.condition}:{' '}
                              <span className="font-mono text-slate-200">
                                {formatNum(val)}
                                {!isMax ? ` / ${formatNum(nextTarget)}` : ' (極意)'}
                              </span>
                            </div>
                            <div className="w-full h-1 bg-slate-900 my-1 overflow-hidden">
                              <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-[8px] text-emerald-300">
                              {curLv > 0 ? def.effectDesc(curLv) : `未発現（Lv1: ${def.effectDesc(1)}）`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {genomeSubTab === 'fused' && (
                    <div className="space-y-1.5">
                      <div className="space-y-1">
                        <div className="text-[9px] font-bold text-amber-300">
                          ⚡ 発動中の戦術・遺伝子共鳴コンボ ({activeSynergies.length}/{SYNERGY_COMBOS_DEF.length})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1">
                          {SYNERGY_COMBOS_DEF.map((syn) => {
                            const active = activeSynergies.some((x) => x.id === syn.id);
                            return (
                              <div
                                key={syn.id}
                                className={`p-1 border ${
                                  active
                                    ? 'bg-amber-950/40 border-amber-400 text-amber-100'
                                    : 'bg-slate-950/60 border-slate-800 text-slate-500'
                                }`}
                              >
                                <div className="font-bold text-[8.5px]">
                                  {active ? '⚡ ' : '○ '}
                                  {syn.name}
                                </div>
                                <div className="text-[7.5px] mt-0.5">{syn.condText}</div>
                                <div className="text-[7.5px] text-emerald-300">{syn.effectText}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {FUSED_GENOME_DEF.map((fd) => {
                          const unlocked = (gameState.fusedGenomes || []).includes(fd.id);
                          const pNames = fd.parents
                            .map((pid) => {
                              const pDef = BASE_GENOME_DEF.find((b) => b.id === pid);
                              return `${pDef?.name || pid}(Lv.${gameState.genomes?.[pid] || 0}/5)`;
                            })
                            .join(' × ');
                          return (
                            <div
                              key={fd.id}
                              className={`p-1.5 border ${
                                unlocked
                                  ? 'bg-purple-950/35 border-purple-500 text-purple-100'
                                  : 'bg-slate-950/60 border-slate-800 text-slate-400'
                              }`}
                            >
                              <div className="flex items-center justify-between font-bold text-[9.5px]">
                                <span>{fd.name}</span>
                                <span className="font-mono text-[8px]">{unlocked ? '★融合済' : '未融合'}</span>
                              </div>
                              <div className="text-[8px] text-slate-400 mt-0.5">条件: {pNames}</div>
                              <div className="text-[8px] text-emerald-300 mt-0.5">{fd.effectDesc}</div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1 border-t border-slate-800">
                        {SECRET_GENOME_DEF.map((sd) => {
                          const unlocked = (gameState.secretGenomes || []).includes(sd.id);
                          return (
                            <div
                              key={sd.id}
                              className={`p-1.5 border ${
                                unlocked
                                  ? 'bg-rose-950/35 border-rose-500 text-rose-100'
                                  : 'bg-slate-950/50 border-slate-800 text-slate-500'
                              }`}
                            >
                              <div className="font-bold text-[9.5px]">{unlocked ? sd.name : '🔮 【隠し遺伝子】？？？'}</div>
                              <div className="text-[8px] mt-0.5">ヒント: {sd.hint}</div>
                              {unlocked && <div className="text-[8px] text-emerald-300 mt-0.5">{sd.effectDesc}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {genomeSubTab === 'archive' && (
                    <div className="space-y-1">
                      <div className="text-[8.5px] text-slate-400">
                        ※ 進路ゲノムはLv.5到達でこちらへ自動整理されつつ、以降も超微量の限界超越成長を継続します。
                      </div>
                      {archivedBaseGenomes.length === 0 ? (
                        <div className="bg-slate-950 border border-slate-800 p-2 text-slate-400">
                          完了・アーカイブされた遺伝子はまだありません。
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                          {archivedBaseGenomes.map((def) => {
                            const curLv = gameState.genomes?.[def.id] || 5;
                            const val = def.getStatVal(gameState);
                            return (
                              <div key={def.id} className="p-1.5 border bg-slate-950/70 border-slate-700 text-slate-300">
                                <div className="flex items-center justify-between font-bold text-[9px]">
                                  <span>{def.name}</span>
                                  <span className="font-mono text-[8px] text-amber-300">
                                    {def.isPathGenome ? `超越Lv.${curLv} (${formatNum(val)}勝)` : 'Lv.5 (融合完了)'}
                                  </span>
                                </div>
                                <div className="text-[8px] text-emerald-400 mt-0.5">{def.effectDesc(curLv)}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ===== TAB 5: タイムリープ（未コンプのみフィルタ＆2x→4x前提ロック＆8x追加＆宇宙試練シークレット化） ===== */}
              {bottomTab === 'reincarnate' && (
                <div className="space-y-1.5">
                  <div className="bg-slate-950 border border-slate-800 px-1.5 py-1 flex flex-wrap items-center justify-between gap-1 text-[9px]">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setLeapSubTab('crystal')}
                        className={`px-2 py-0.5 border font-bold cursor-pointer ${
                          leapSubTab === 'crystal'
                            ? 'bg-purple-900 border-purple-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        💎 結晶強化・転生
                      </button>
                      {canUnlockAscension && (
                        <button
                          onClick={() => setLeapSubTab('ascension')}
                          className={`px-2 py-0.5 border font-bold cursor-pointer ${
                            leapSubTab === 'ascension'
                              ? 'bg-amber-900 border-amber-400 text-white'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          👑 上位転生・宇宙評議会
                        </button>
                      )}
                      {canUnlockAscension && (
                        <button
                          onClick={() => setLeapSubTab('challenges')}
                          className={`px-2 py-0.5 border font-bold cursor-pointer ${
                            leapSubTab === 'challenges'
                              ? 'bg-rose-900 border-rose-400 text-white'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          ⚔️ 縛りチャレンジ({gameState.completedChallenges?.length || 0}/8)
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 font-mono">
                      <label className="flex items-center gap-0.5 text-[8.5px] text-amber-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hideCompleted}
                          onChange={(e) =>
                            setGameState((p) => ({
                              ...p,
                              qolToggles: { ...p.qolToggles, hideCompleted: e.target.checked }
                            }))
                          }
                          className="accent-amber-400"
                        />
                        未コンプのみ
                      </label>
                      {[1, 10, 'max'].map((amt) => (
                        <button
                          key={String(amt)}
                          onClick={() => setBuyAmount(amt)}
                          className={`px-1.5 py-0.5 border cursor-pointer ${
                            buyAmount === amt
                              ? 'bg-purple-900 border-purple-400 text-white font-bold'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {amt === 'max' ? 'MAX' : `${amt}x`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* サブタブ①：通常タイムリープ ＆ 継承結晶アップグレード */}
                  {leapSubTab === 'crystal' && (
                    <div className="space-y-1.5">
                      <div className="bg-purple-950/35 border border-purple-700 p-1.5 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-purple-200">
                            記憶とゲノムを宿して5歳の春へタイムリープ（保有: 💎{formatNum(gameState.legacyPoints)}）
                          </div>
                          <div className="text-[8.5px] text-purple-300/80">
                            獲得予定: 💎+{formatNum(legacyGain)}（頭の中の知識・趣味・戦術熟練・ゲノムは永続継承）
                          </div>
                        </div>
                        {!confirmReincarnate ? (
                          <button
                            onClick={() => setConfirmReincarnate(true)}
                            className="px-2.5 py-1 bg-purple-700 hover:bg-purple-600 text-white font-bold text-[10px] cursor-pointer shrink-0"
                          >
                            タイムリープする (+💎{formatNum(legacyGain)})
                          </button>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => openCreatorModal('reincarnate')}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[9.5px] cursor-pointer"
                            >
                              実行確定
                            </button>
                            <button
                              onClick={() => setConfirmReincarnate(false)}
                              className="px-1.5 py-1 bg-slate-800 text-slate-300 text-[9.5px] cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {LEGACY_UPGRADES_DEF.filter((u) => !hideCompleted || (gameState.legacyUpgrades?.[u.id] || 0) < u.maxLv).map((upg) => {
                          const curLv = gameState.legacyUpgrades?.[upg.id] || 0;
                          const isMax = curLv >= upg.maxLv;
                          const reqMissing = upg.requiresId && (gameState.legacyUpgrades?.[upg.requiresId] || 0) < 1;
                          const calc = calcBulkSingleResource(
                            curLv,
                            upg.maxLv,
                            buyAmount,
                            gameState.legacyPoints,
                            upg.baseCost,
                            upg.growth
                          );
                          const singleCost = Math.floor(upg.baseCost * Math.pow(upg.growth, curLv));
                          const canAfford = !isMax && !reqMissing && calc.count > 0;
                          const isQol = Boolean(upg.tag);
                          return (
                            <button
                              key={upg.id}
                              onMouseEnter={() => setInspectorText(`💎 ${upg.name}：${upg.desc}`)}
                              onClick={() => buyLegacyUpgrade(upg)}
                              disabled={!canAfford}
                              className={`p-1.5 border text-left flex flex-col justify-between ${
                                isMax
                                  ? isQol
                                    ? 'bg-sky-950/35 border-sky-500/70 text-sky-100'
                                    : 'bg-slate-900/60 border-purple-700/50 opacity-75'
                                  : canAfford
                                    ? isQol
                                      ? 'bg-slate-950 hover:bg-sky-950/30 border-sky-500/80 cursor-pointer'
                                      : 'bg-slate-950 hover:bg-slate-800 border-purple-700/80 cursor-pointer'
                                    : 'bg-slate-950/50 border-slate-800 opacity-45 cursor-not-allowed'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className={`text-[9.5px] font-bold truncate ${isQol ? 'text-sky-200' : 'text-purple-200'}`}
                                >
                                  {upg.name}
                                </span>
                                <span className="text-[8.5px] font-mono text-slate-400 shrink-0">
                                  Lv.{curLv}/{upg.maxLv}
                                </span>
                              </div>
                              <div className="text-[8px] text-slate-300 my-0.5">{upg.short}</div>
                              <div
                                className={`text-[8.5px] font-mono font-bold ${isQol ? 'text-sky-300' : 'text-purple-300'}`}
                              >
                                {isMax
                                  ? '✅ 解放済み'
                                  : reqMissing
                                    ? '🔒 先に2x倍速思考を購入'
                                    : calc.count > 1
                                      ? `+${calc.count}Lv (💎 ${formatNum(calc.totalCost)})`
                                      : `💎 ${formatNum(singleCost)}`}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* サブタブ②：上位転生（8x速度解放＆宇宙エンドコンテンツ試練シークレット表示！） */}
                  {leapSubTab === 'ascension' && canUnlockAscension && (
                    <div className="space-y-1.5">
                      <div className="bg-amber-950/30 border border-amber-500 p-1.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-amber-200 flex items-center gap-1">
                              <Crown size={11} />
                              {ascCount === 0
                                ? '第2段階転生「輪廻超越」'
                                : ascCount === 1
                                  ? '第3段階転生「星辰輪廻」'
                                  : ascCount === 2
                                    ? '第4段階転生「創世神転生」'
                                    : '第5段階転生「宇宙フットボール評議会」'}
                              （超越の聖杯: 🏆{formatNum(gameState.ascensionPoints || 0)}）
                            </div>
                            <div className="text-[8px] text-amber-300/80">
                              条件: 結晶強化合計Lv.{ascReqCrystalLv}以上(現在{legLvSum}) ＆ {CATEGORIES[ascReqCatId].name}到達（転生予定: 🏆+
                              {formatNum(ascensionGainPreview)}）
                            </div>
                          </div>

                          {!confirmAscend ? (
                            <button
                              onClick={() => setConfirmAscend(true)}
                              disabled={!canAscendNow}
                              className="px-2 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-extrabold text-[9.5px] cursor-pointer shrink-0"
                            >
                              {canAscendNow ? `高次元転生 (+🏆${formatNum(ascensionGainPreview)})` : '条件未達'}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => openCreatorModal('ascend')}
                                className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[9.5px] cursor-pointer"
                              >
                                聖杯獲得・転生確定
                              </button>
                              <button
                                onClick={() => setConfirmAscend(false)}
                                className="px-1.5 py-1 bg-slate-800 text-slate-300 text-[9.5px] cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {visibleAscensionUpgrades
                          .filter((u) => !hideCompleted || (gameState.ascensionUpgrades?.[u.id] || 0) < u.maxLv)
                          .map((upg) => {
                            const curLv = gameState.ascensionUpgrades?.[upg.id] || 0;
                            const isMax = upg.maxLv && curLv >= upg.maxLv;
                            const calc = calcBulkSingleResource(
                              curLv,
                              upg.maxLv,
                              buyAmount,
                              gameState.ascensionPoints || 0,
                              upg.baseCost,
                              upg.growth
                            );
                            const singleCost = Math.floor(upg.baseCost * Math.pow(upg.growth, curLv));
                            const canAfford = !isMax && calc.count > 0;

                            return (
                              <button
                                key={upg.id}
                                onMouseEnter={() => setInspectorText(`🏆 ${upg.name}：${upg.desc}`)}
                                onClick={() => buyAscensionUpgrade(upg)}
                                disabled={!canAfford}
                                className={`p-1 border text-left ${
                                  isMax
                                    ? 'bg-slate-900/60 border-amber-700/50 opacity-75'
                                    : canAfford
                                      ? 'bg-slate-950 hover:bg-slate-800 border-amber-600/80 cursor-pointer'
                                      : 'bg-slate-950/50 border-slate-800 opacity-45 cursor-not-allowed'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[9.5px] font-bold text-amber-200">{upg.name}</span>
                                  <span className="text-[8.5px] font-mono text-slate-400">
                                    Lv.{curLv}/{upg.maxLv}
                                  </span>
                                </div>
                                <div className="text-[8px] text-slate-300">{upg.short}</div>
                                <div className="text-[8.5px] font-mono font-bold text-amber-300">
                                  {isMax
                                    ? '✅ 解放済み'
                                    : calc.count > 1
                                      ? `+${calc.count}Lv (🏆 ${formatNum(calc.totalCost)})`
                                      : `🏆 ${formatNum(singleCost)}`}
                                </div>
                              </button>
                            );
                          })}
                      </div>

                      <div className="space-y-1 pt-1 border-t border-amber-800/50">
                        <div className="text-[9px] font-bold text-amber-200">
                          🔥 神域・宇宙エンドコンテンツ試練（達成したもののみ正体が明かされる）
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {ENDGAME_TRIALS_DEF.map((tr, idx) => {
                            const done = gameState.completedTrials?.includes(tr.id);
                            return (
                              <div
                                key={tr.id}
                                className={`p-1 border text-[8px] ${
                                  done
                                    ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200'
                                    : 'bg-slate-950/70 border-slate-800 text-slate-500'
                                }`}
                              >
                                <div className="font-bold">
                                  {done ? `✅ ${tr.name}` : `🔒 シークレット試練 #${idx + 1}（未達成）`}
                                </div>
                                <div>
                                  {done
                                    ? `${tr.desc}（${tr.rewardText}）`
                                    : '極限のキャリアを歩むことで封印された試練が達成される…'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* サブタブ③：縛り輪廻チャレンジ */}
                  {leapSubTab === 'challenges' && canUnlockAscension && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1 bg-rose-950/25 border border-rose-800/70 p-1.5">
                        <span className="text-[9px] font-bold text-rose-300">
                          ⚔️ 縛りチャレンジ（終了・棄権後は挑戦前の全資産へ完全復元！）
                        </span>
                        {gameState.activeChallenge && (
                          <button
                            onClick={abandonChallengeRun}
                            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-rose-500 text-rose-200 font-bold text-[8.5px] cursor-pointer"
                          >
                            🔄 挑戦終了＆元資産へ完全復元
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {CHALLENGES_DEF.filter((ch) => !hideCompleted || !gameState.completedChallenges?.includes(ch.id)).map(
                          (ch) => {
                            const done = gameState.completedChallenges?.includes(ch.id);
                            const active = gameState.activeChallenge === ch.id;
                            return (
                              <div
                                key={ch.id}
                                className={`p-1.5 border flex flex-col justify-between ${
                                  done
                                    ? 'bg-emerald-950/30 border-emerald-500 text-emerald-100'
                                    : active
                                      ? 'bg-rose-950/50 border-rose-400 text-rose-100'
                                      : 'bg-slate-950 border-slate-800 text-slate-300'
                                }`}
                              >
                                <div>
                                  <div className="flex items-center justify-between font-bold text-[9.5px]">
                                    <span>
                                      {ch.code}: {ch.name}
                                    </span>
                                    <span className="font-mono text-[8px]">
                                      {done ? '✅ 制覇済' : active ? '🔥 挑戦中' : '未制覇'}
                                    </span>
                                  </div>
                                  <div className="text-[8px] text-rose-300 mt-0.5">{ch.ruleText}</div>
                                  <div className="text-[8px] text-slate-400">{ch.goalText}</div>
                                  <div className="text-[8px] text-amber-300 mt-0.5">{ch.rewardText}</div>
                                </div>
                                {!done && !active && (
                                  <button
                                    onClick={() => startChallengeRun(ch)}
                                    disabled={Boolean(gameState.activeChallenge)}
                                    className="mt-1 py-0.5 bg-rose-800 hover:bg-rose-700 disabled:opacity-40 text-white font-bold text-[8.5px] cursor-pointer"
                                  >
                                    この縛りで輪廻スタート（資産保護付）
                                  </button>
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ===== TAB 6: 殿堂 ＆ マルチエンディング図鑑 ===== */}
              {bottomTab === 'hall' && (
                <div className="space-y-1.5">
                  {/* ===== トロフィー一覧 ===== */}
                  <div className="bg-gradient-to-r from-amber-950/40 to-slate-950 border border-amber-700/60 p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[11px] text-amber-200">🏆 トロフィー</span>
                      <span className="font-mono text-[10px] text-amber-300">
                        {trophyDone} / {trophyTotal}（{trophyPct}%）
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-900 overflow-hidden">
                      <div className="h-full bg-amber-400" style={{ width: `${trophyPct}%` }} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {trophySections.map((sec) => {
                        const full = sec.done >= sec.total && sec.total > 0;
                        return (
                          <div
                            key={sec.key}
                            title={sec.items
                              .map((it) => `${it.got ? '✅' : '・'} ${it.name}`)
                              .join('\n')}
                            className={`p-1.5 border text-[9px] ${
                              full
                                ? 'bg-amber-950/40 border-amber-500 text-amber-100'
                                : 'bg-slate-950 border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate">
                                {sec.icon} {sec.label}
                              </span>
                              {full && <span className="text-[8px] shrink-0">👑</span>}
                            </div>
                            <div className="font-mono text-[11px] font-bold mt-0.5">
                              {sec.done}
                              <span className="text-[8.5px] font-normal text-slate-400">/{sec.total}</span>
                            </div>
                            <div className="w-full h-0.5 bg-slate-900 mt-1 overflow-hidden">
                              <div
                                className={full ? 'h-full bg-amber-400' : 'h-full bg-sky-500'}
                                style={{ width: `${sec.total ? (sec.done / sec.total) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[8.5px] text-slate-500">
                      各カードにカーソルを合わせると、何を取って何が残っているかが出る。
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-amber-300">
                      📖 キャリア・マルチエンディング図鑑 ({gameState.unlockedEndings?.length || 0}/{ENDINGS_DEF.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                      {ENDINGS_DEF.map((ed) => {
                        const unlocked = gameState.unlockedEndings?.includes(ed.id);
                        return (
                          <div
                            key={ed.id}
                            className={`p-1.5 border ${
                              unlocked
                                ? 'bg-amber-950/35 border-amber-500 text-amber-100'
                                : 'bg-slate-950/60 border-slate-800 text-slate-500'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold text-[9px]">
                              <span>
                                {ed.code}: {unlocked ? ed.name : '？？？'}
                              </span>
                              <span className="font-mono text-[8px]">{unlocked ? '★達成' : '未達成'}</span>
                            </div>
                            <div className="text-[8px] mt-0.5">{ed.desc}</div>
                            <div className="text-[8px] text-emerald-300 mt-0.5">{ed.rewardText}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1 pt-1 border-t border-slate-800">
                    <div className="text-[9px] font-bold text-slate-300">🏆 歴代タイムリープ記録（殿堂）</div>
                    {!gameState.hallOfFame || gameState.hallOfFame.length === 0 ? (
                      <div className="bg-slate-950 border border-slate-800 p-2 text-slate-400">
                        まだタイムリープの記録はありません。
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {gameState.hallOfFame.map((h, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-950 border border-slate-800 px-2 py-1 flex items-center justify-between text-[9px] font-mono tabular-nums"
                          >
                            <span className="text-amber-300 font-bold">
                              周回.{h.gen} {h.name} [{h.pos}/{h.height}cm]
                            </span>
                            <span className="text-slate-300">{h.cat}</span>
                            <span className="text-sky-300">ピーク総合{formatNum(h.rating, 1)}</span>
                            <span className="text-purple-300">
                              {h.crystals > 0 ? `+💎${formatNum(h.crystals)}` : '上位転生'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        {/* ---------- 右ペイン：開閉式スリム選手年代記 ---------- */}
        {showLogDrawer && (
          <aside className="md:w-56 shrink-0 bg-slate-900 border border-slate-800 flex flex-col max-h-40 md:max-h-none">
            <div className="px-2 py-1 border-b border-slate-800 bg-slate-950 flex items-center justify-between text-[9px] font-bold text-slate-300">
              <span>選手年代記</span>
              <button
                onClick={() => setShowLogDrawer(false)}
                className="text-slate-400 hover:text-white font-mono cursor-pointer"
              >
                ×閉じる
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 text-[8.5px]">
              {gameState.log.map((entry) => (
                <div
                  key={entry.id}
                  className={`border-l-2 pl-1.5 py-0.5 leading-snug ${
                    entry.type === 'levelup'
                      ? 'border-amber-400 text-amber-200 bg-amber-950/20'
                      : entry.type === 'match'
                        ? 'border-emerald-500 text-emerald-200'
                        : entry.type === 'story'
                          ? 'border-purple-400 text-purple-200 bg-purple-950/20'
                          : 'border-slate-700 text-slate-400'
                  }`}
                >
                  <div className="font-mono text-[8px] text-slate-500">[{entry.stamp}]</div>
                  <div>{entry.text}</div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
{/* ================= 画面右下フローティング通知（左下の結晶表示を塞がない配置！） ================= */}
{toasts.length > 0 && (
        <div className="fixed bottom-2 right-2 z-40 flex flex-col gap-1 pointer-events-none max-w-xs">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="bg-slate-900/95 border border-amber-500/80 px-2.5 py-1 shadow-lg text-[9px]"
            >
              <div className="font-bold text-amber-300">{t.title}</div>
              <div className="text-slate-200">{t.desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* ================= モーダル⓪：初回＆アップデート時チュートリアル確認モーダル ================= */}
      {/* ================= モーダル：周回で新しく解放された機能 ================= */}
      {unlockModalItems.length > 0 && !creatorModal.open && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-sky-500 max-w-lg w-full p-3.5 space-y-3 text-xs max-h-[85vh] overflow-y-auto">
            <div className="border-b border-slate-800 pb-1.5">
              <div className="font-bold text-sm text-sky-300">
                🔓 第{gameState.totalGenerations || gameState.generation}周目・新しくできるようになったこと
              </div>
              <div className="text-[10px] text-slate-400">
                前の人生で得た知識が、ようやく形になった
              </div>
            </div>

            {unlockModalItems.map((u) => (
              <div key={u.id} className="space-y-1.5">
                <div className="font-bold text-[13px] text-sky-200">
                  {u.icon} {u.name}
                </div>
                <div className="text-[10px] text-emerald-300">{u.summary}</div>
                <div className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line bg-slate-950/70 border border-slate-800 p-2">
                  {u.flavor}
                </div>
              </div>
            ))}

            <button
              onClick={() => setGameState((prev) => ({ ...prev, pendingUnlocks: null }))}
              className="w-full py-2 bg-sky-700 hover:bg-sky-600 border border-sky-300 text-white font-bold text-xs cursor-pointer"
            >
              わかった
            </button>
          </div>
        </div>
      )}

      {/* ================= モーダル: エンディング／上位転生の本文 ================= */}
      {gameState.pendingEnding && !creatorModal.open && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-amber-400 max-w-md w-full p-3.5 space-y-2.5 text-xs max-h-[88vh] overflow-y-auto">
            <div className="border-b border-slate-800 pb-1.5">
              <div className="font-bold text-sm text-amber-300">
                {gameState.pendingEnding.code} {gameState.pendingEnding.name}
              </div>
              {gameState.pendingEnding.sub && (
                <div className="text-[10px] text-slate-400">{gameState.pendingEnding.sub}</div>
              )}
            </div>
            <div className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line bg-slate-950/70 border border-slate-800 p-2.5">
              {gameState.pendingEnding.text}
            </div>
            {gameState.pendingEnding.reward && (
              <div className="text-[10px] text-emerald-300">{gameState.pendingEnding.reward}</div>
            )}
            <button
              onClick={() => setGameState((prev) => ({ ...prev, pendingEnding: null }))}
              className="w-full py-2 bg-amber-700 hover:bg-amber-600 border border-amber-300 text-white font-bold text-xs cursor-pointer"
            >
              読み終えた
            </button>
          </div>
        </div>
      )}

      {tutorialModalOpen && !creatorModal.open && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-amber-400 max-w-md w-full p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-bold text-sm text-amber-300">
                ⚽ Football Chronicle — タイムリープ原則＆遊び方ガイド
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-cyan-950 border border-cyan-500 text-cyan-200">
                GUIDE
              </span>
            </div>

            <div className="space-y-2 text-[10.5px] text-slate-200 leading-relaxed">
              <div className="bg-slate-950 border border-slate-800 p-2 space-y-1">
                <div className="font-bold text-sky-300">① タイムリープの原理原則（知識は永続・肉体はリセット）</div>
                <p>
                  頭の中の<strong>趣味知識・戦術熟練・未来予知(競馬/投資記憶)・遺伝子・習慣熟練</strong>は転生後も永続保持！一方、肉体能力・今世の人間関係・メディア出演歴はリセットされます（倍速機能も結晶で解放）。
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-2 space-y-1">
                <div className="font-bold text-emerald-300">② 全項目MAX一括購入 ＆ 師弟・恋愛コンプ ＆ 子ども選手ルート</div>
                <p>
                  <strong>MAX設定</strong>で同僚・施設・趣味・ブランドまで全項目が一気に最大まで購入可能！愛弟子・恋愛相手はいつでも切替＆コンプ図鑑化でき、<strong>第一子誕生後は26歳以上で子どもがサッカー選手としてデビュー</strong>します。
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-2 space-y-1">
                <div className="font-bold text-amber-300">③ タイムリープ＆縛りチャレンジ資産保護</div>
                <p>
                  縛りチャレンジ中は制限項目が無効化されますが、目標達成または棄権転生時に元の資産へ完全復元されます。
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={closeTutorialModal}
              className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs cursor-pointer"
            >
              理解してプレイ開始！（次回以降は自動非表示）
            </button>
          </div>
        </div>
      )}

      {/* ================= モーダル①：選手クリエイト（新規・通常転生・上位転生共通） ================= */}
      {creatorModal.open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full p-3 space-y-2.5 text-xs">
            <div className="font-bold text-sm text-amber-300">
              {creatorModal.mode === 'new'
                ? '⚽ Football Chronicle — 選手プロフィール設定'
                : creatorModal.mode === 'ascend'
                  ? `👑 上位転生発動！（超越の聖杯 🏆+${creatorModal.ascensionAwarded || 0} 獲得 / 第${(gameState.totalGenerations || gameState.generation) + 1}周目）`
                  : `⏳ 第${(gameState.totalGenerations || gameState.generation) + 1}周目 — 新たなる輪廻の始まり`}
            </div>

            {creatorModal.mode === 'new' && (
              <div className="bg-indigo-950/50 border border-indigo-700 p-2 text-[10px] text-indigo-100 leading-snug">
                5歳から始まるサッカー育成放置RPG！練習と試合を重ねて成長し、才能の限界を迎えたら<strong>タイムリープ（転生）</strong>で頭の中の知識と遺伝子を宿したまま5歳の春へ戻り、世界の頂点を目指そう！
              </div>
            )}

            {creatorModal.mode === 'ascend' && (
              <div className="bg-amber-950/50 border border-amber-500 p-2 text-[10px] text-amber-100 leading-snug">
                上位転生により<strong>超越の聖杯 🏆+{creatorModal.ascensionAwarded || 0}</strong> を獲得しました！今世のポジションと体格を選択して、新たな次元へ旅立とう！
              </div>
            )}

            {creatorModal.selectedChallenge && (
              <div className="bg-rose-950/60 border border-rose-500 p-2 text-[10px] text-rose-100">
                🔥 縛りチャレンジ有効:{' '}
                <strong>{CHALLENGES_DEF.find((c) => c.id === creatorModal.selectedChallenge)?.name}</strong>
                （終了後は元の資産へ完全復元されます）
              </div>
            )}

            {creatorModal.mode === 'new' ? (
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block">選手名</label>
                <input
                  type="text"
                  maxLength={14}
                  value={creatorModal.playerName}
                  onChange={(e) => setCreatorModal((prev) => ({ ...prev, playerName: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-1 text-slate-100 text-xs focus:outline-none focus:border-sky-400"
                />
              </div>
            ) : (
              // タイムリープは同一人物が5歳に戻るだけなので、名前は変わらない。
              // 変えたいときは「システム・セーブ管理」から。
              <div className="bg-slate-950 border border-slate-800 p-1.5 text-[10px] text-slate-400">
                選手名 <strong className="text-slate-100 text-[11px]">{creatorModal.playerName}</strong>
                <span className="ml-1 text-[9px]">（同じ人生をやり直すので変わらない。変更はシステム設定から）</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 block">体格タイプ（体格ごとに固有ゲノム＆共鳴コンボあり）</label>
              <div className="grid grid-cols-2 gap-1">
                {Object.values(BODY_TYPES).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setCreatorModal((prev) => ({ ...prev, bodyType: b.id }))}
                    className={`p-1.5 border text-left cursor-pointer ${
                      creatorModal.bodyType === b.id
                        ? 'bg-sky-900/70 border-sky-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-[10px]">{b.label}</div>
                    <div className="text-[8.5px] text-slate-400 leading-tight mt-0.5">{b.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className={`space-y-1 ${creatorModal.mode === 'new' ? '' : 'hidden'}`}>
              <label className="text-[10px] text-slate-400 block">
                出場ポジション（キャリア中はいつでも変更できる・50試合出場で特性永続習得）
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                {Object.values(POSITIONS).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCreatorModal((prev) => ({ ...prev, position: p.id }))}
                    className={`p-1 border text-left cursor-pointer ${
                      creatorModal.position === p.id
                        ? 'bg-emerald-900/70 border-emerald-400 text-white font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="text-[9.5px]">{p.id}</div>
                    <div className="text-[8px] text-slate-400 truncate">{(p.label || p.name || '').split(' ')[1] || ''}</div>                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfirmCreator}
              className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold text-xs cursor-pointer"
            >
              {creatorModal.mode === 'new' ? '5歳4月からキャリアを開始する' : '知識とゲノムを宿してキャリアを開始する'}
            </button>
          </div>
        </div>
      )}

      {/* ================= モーダル②：進路選択（12歳・15歳・18歳） ================= */}
      {careerChoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-amber-500/80 max-w-lg w-full p-3 space-y-2 text-xs">
            <div className="border-b border-slate-800 pb-1.5">
              <div className="font-bold text-sm text-amber-300">{careerChoiceModal.heading}</div>
              <div className="text-[10px] text-slate-300">{careerChoiceModal.sub}</div>
            </div>

            <div className="space-y-1.5 max-h-[65vh] overflow-y-auto pt-1">
              {careerChoiceModal.options.map((opt) => (
                <button
                  key={opt.id}
                  disabled={!opt.unlocked}
                  onClick={() => handleSelectCareerPath(opt)}
                  className={`w-full p-2 border text-left block ${
                    opt.unlocked
                      ? 'bg-slate-950 hover:bg-slate-800 border-sky-500/80 cursor-pointer'
                      : 'bg-slate-950/50 border-slate-800 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[11px] text-slate-100">{opt.title}</span>
                    <span className="text-[9px] font-mono text-amber-300 shrink-0">{opt.reqText}</span>
                  </div>
                  <div className="text-[9.5px] text-slate-300 mt-0.5">{opt.perkSummary}</div>
                  {renderGenomeTag(opt.genomeId, opt.genomeName)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= モーダル③：世代引退・タイムリープ演出 ================= */}
      {truckEventModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-purple-500 max-w-md w-full p-3.5 space-y-2.5 text-xs">
            <div className="font-bold text-sm text-purple-300">{truckEventModal.heading}</div>
            <div className="space-y-1.5 text-[11px] text-slate-200 leading-relaxed">
              {truckEventModal.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="bg-purple-950/50 border border-purple-700 p-2 text-[10px] text-purple-200 font-mono">
              獲得継承結晶: 💎 +{formatNum(legacyGain)}（次の周回で倍速解放や才能上限を強化しよう！）
            </div>
            {canAscendNow && (
              <button
                onClick={() => handleProceedFromTruckModal('ascend')}
                className="w-full py-2 bg-amber-600 hover:bg-amber-500 border border-amber-300 text-slate-950 font-extrabold text-xs cursor-pointer"
              >
                👑 高次元転生する（超越の聖杯 +{formatNum(ascensionGainPreview)}）
              </button>
            )}
            <button
              onClick={() => handleProceedFromTruckModal()}
              className="w-full py-2 bg-purple-700 hover:bg-purple-600 border border-purple-300 text-white font-bold text-xs cursor-pointer"
            >
              5歳の春へタイムリープする
            </button>
          </div>
        </div>
      )}

      {/* ================= モーダル⑤：システム詳細 ＆ セーブ管理 ================= */}
      {showHelp && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full p-3 space-y-2 text-[10px] leading-relaxed max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1">
              <span className="font-bold text-xs text-amber-300">⚽ システム詳細 ＆ セーブデータ管理</span>
              <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-white cursor-pointer">
                ✕
              </button>
            </div>
            <div className="bg-slate-950 border border-slate-800 p-2 space-y-2">
              <div className="font-bold text-[11px] text-sky-300">⚙️ 設定</div>

              <div className="space-y-1">
                <label className="text-[9px] text-slate-400 block" htmlFor="setting-player-name">
                  選手名（タイムリープしても変わらない。ここでだけ変更できる）
                </label>
                <input
                  id="setting-player-name"
                  type="text"
                  maxLength={14}
                  value={gameState.playerName}
                  onChange={(e) =>
                    setGameState((prev) => ({ ...prev, playerName: e.target.value.slice(0, 14) }))
                  }
                  className="w-full bg-slate-900 border border-slate-700 px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-slate-400 block" htmlFor="setting-home-club">
                  地元クラブの名前（お気に入りのクラブ名を付けられる）
                </label>
                <input
                  id="setting-home-club"
                  type="text"
                  maxLength={16}
                  value={gameState.homeClubName || '蒼空FC'}
                  onChange={(e) =>
                    setGameState((prev) => ({ ...prev, homeClubName: e.target.value.slice(0, 16) }))
                  }
                  className="w-full bg-slate-900 border border-slate-700 px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-sky-400"
                />
              </div>

              <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gameState.qolToggles?.pauseOnRebirth !== false}
                  onChange={(e) =>
                    setGameState((prev) => ({
                      ...prev,
                      qolToggles: { ...prev.qolToggles, pauseOnRebirth: e.target.checked }
                    }))
                  }
                  className="accent-sky-400"
                />
                転生した直後に時間を止める（方針を決めてから再開できる）
              </label>
            </div>

            <p>
              <strong className="text-sky-300">1. タイムリープの原理原則（知識の永続継承）：</strong>
              タイムリープすると肉体・年齢・今世の人間関係・メディア出演歴はリセットされますが、頭の中の知識（趣味知識・戦術熟練・未来予知競馬記憶・遺伝子・習慣熟練）はすべて次の輪廻へ引き継がれます。
            </p>
            <p>
              <strong className="text-amber-300">2. 師弟＆恋愛コンプ図鑑 ＆ 子どもサッカー選手ルート：</strong>
              2周目以降に愛弟子4人と恋愛パートナー3人を自由に切り替えてコンプ可能！さらに第一子誕生後に26歳以上になると、愛児がプロサッカー選手としてデビューし親子共闘できます。
            </p>
            <p>
              <strong className="text-emerald-300">3. 100周目以降の神域バランス＆宇宙評議会：</strong>
              第1〜第5段階転生（宇宙フットボール評議会）と縛りチャレンジCH1〜CH8を乗り越え、100周目以降の神域カテゴリ制覇を目指しましょう。
            </p>

            {/* セーブデータ管理セクション */}
            <div className="border-t border-slate-800 pt-2 space-y-1.5">
              <div className="font-bold text-slate-200">💾 セーブデータのバックアップ・復元</div>
              <div className="flex gap-1">
                <button
                  onClick={handleExportSave}
                  className="flex-1 py-1 px-2 bg-sky-950 hover:bg-sky-900 border border-sky-600 text-sky-200 font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Download size={11} /> 書き出し(コピー)
                </button>
                <button
                  onClick={handleImportSave}
                  className="flex-1 py-1 px-2 bg-emerald-950 hover:bg-emerald-900 border border-emerald-600 text-emerald-200 font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Upload size={11} /> テキストから復元
                </button>
              </div>
              <textarea
                rows={2}
                value={saveTransferText}
                onChange={(e) => setSaveTransferText(e.target.value)}
                placeholder="書き出しデータ、または復元したいセーブJSONを貼り付け..."
                className="w-full bg-slate-950 border border-slate-800 p-1 text-[9px] font-mono text-slate-300 focus:outline-none focus:border-sky-500"
              />

              <div className="pt-1 flex items-center justify-between">
                {!confirmHardReset ? (
                  <button
                    onClick={() => setConfirmHardReset(true)}
                    className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[9px] flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw size={10} /> 全データ初期化
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        try {
                          localStorage.removeItem(SAVE_KEY);
                          for (const k of LEGACY_SAVE_KEYS) localStorage.removeItem(k);
                        } catch (e) {
                          // ignore storage restrictions
                        }
                        setConfirmHardReset(false);
                        setShowHelp(false);
                        setCreatorModal({
                          open: true,
                          mode: 'new',
                          ascensionAwarded: 0,
                          playerName: '蒼井 翼',
                          bodyType: 'balanced',
                          position: 'CF',
                          selectedChallenge: null
                        });
                      }}
                      className="px-2 py-1 bg-rose-700 border border-rose-300 text-white font-bold text-[9px] cursor-pointer"
                    >
                      本当に完全消去する
                    </button>
                    <button
                      onClick={() => setConfirmHardReset(false)}
                      className="px-2 py-1 bg-slate-800 border border-slate-600 text-slate-300 text-[9px] cursor-pointer"
                    >
                      中止
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setShowHelp(false)}
                  className="px-4 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-bold cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}