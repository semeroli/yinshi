/**
 * 演示诗词库 + 意象解析（离线演示模式）
 * 文档 v2.0 中 ① 意象解析 / ② 格律成诗 在无 API Key 时的本地替代实现。
 * 接入真实模型后，这些数据只作为兜底通道。
 */

export const POEMS = [
  {
    id: 'w1',
    form: '五言绝句',
    style: '婉约',
    mood: '怅惘',
    season: '秋',
    time: '夜',
    title: '江夜寄远',
    lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟客', '天涯共月明'],
    imagery: ['孤灯', '寒江', '夜潮', '远月'],
    paraphrase: ['一盏孤灯映着傍晚的小洲', '寒冷的江渚上夜潮暗生', '遥想当年同舟共济的人', '天涯海角共对一轮明月'],
  },
  {
    id: 'w2',
    form: '五言绝句',
    style: '冲淡',
    mood: '冲淡',
    season: '夏',
    time: '清晨',
    title: '山居',
    lines: ['空山新雨歇', '松径落云深', '独坐听流泉', '苔痕上石心'],
    imagery: ['空山', '松径', '流泉', '苔痕'],
    paraphrase: ['空山里一场新雨刚停', '松间小径上云雾沉沉', '独自坐着听山泉流淌', '青苔慢慢长上石头的纹路'],
  },
  {
    id: 'w3',
    form: '五言绝句',
    style: '婉约',
    mood: '怅惘',
    season: '秋',
    time: '夜',
    title: '秋窗',
    lines: ['疏影横窗瘦', '西风卷叶频', '一灯明灭里', '谁念未归人'],
    imagery: ['疏影', '西风', '孤灯', '落叶'],
    paraphrase: ['稀疏的树影横在窗上显得清瘦', '西风卷着落叶一阵紧似一阵', '在一盏忽明忽暗的灯下', '有谁惦念着未归的人'],
  },
  {
    id: 'w4',
    form: '五言绝句',
    style: '豪放',
    mood: '雄浑',
    season: '冬',
    time: '黄昏',
    title: '塞下曲',
    lines: ['大漠风沙急', '孤城落日黄', '弓刀寒不卸', '夜雪满征裳'],
    imagery: ['大漠', '孤城', '落日', '夜雪'],
    paraphrase: ['大漠里风沙刮得又急又猛', '孤城的落日一片昏黄', '弓刀在手寒得不肯卸下', '夜里的大雪落满了征衣'],
  },
  {
    id: 'w5',
    form: '五言绝句',
    style: '冲淡',
    mood: '闲适',
    season: '春',
    time: '清晨',
    title: '春晓',
    lines: ['东风扶柳起', '微雨湿花梢', '欲问春深浅', '莺声过小桥'],
    imagery: ['东风', '垂柳', '微雨', '莺声'],
    paraphrase: ['东风把柳枝轻轻扶起', '细雨打湿了枝头的花', '想问一问春天有多深了', '只听莺声飞过小桥'],
  },
  {
    id: 'w6',
    form: '五言绝句',
    style: '冲淡',
    mood: '阑珊',
    season: '秋',
    time: '黄昏',
    title: '秋江晚望',
    lines: ['落霞沉远水', '归雁点寒空', '一叶随风去', '江天入晚钟'],
    imagery: ['落霞', '归雁', '孤舟', '晚钟'],
    paraphrase: ['落霞沉进远处的水面', '归雁点缀着清寒的天空', '一片叶子随风吹走', '江天之间响起晚钟'],
  },
  {
    id: 'w7',
    form: '五言绝句',
    style: '冲淡',
    mood: '幽静',
    season: '夏',
    time: '夜',
    title: '山夜',
    lines: ['明月悬松顶', '幽人独未眠', '泉声随影碎', '露重湿琴弦'],
    imagery: ['明月', '松林', '流泉', '清露'],
    paraphrase: ['明月挂在松树顶上', '幽居的人独自没有入睡', '泉声随着月影碎裂', '露水浓重打湿了琴弦'],
  },
  {
    id: 'w8',
    form: '五言绝句',
    style: '婉约',
    mood: '离愁',
    season: '春',
    time: '黄昏',
    title: '长亭送别',
    lines: ['长亭折柳处', '烟雨湿行舟', '莫问归期近', '江声送客愁'],
    imagery: ['长亭', '折柳', '烟雨', '行舟'],
    paraphrase: ['在长亭折下柳枝的地方', '烟雨打湿了远行的船', '不要问归期还有多近', '江声一路送着离愁'],
  },
  {
    id: 'q1',
    form: '七言绝句',
    style: '豪放',
    mood: '雄浑',
    season: '秋',
    time: '黄昏',
    title: '塞上曲',
    lines: ['大漠风高卷暮旌', '长河落日浸孤城', '挥鞭直指燕然石', '待勒功名照汗青'],
    imagery: ['大漠', '长河', '落日', '孤城', '旌旗'],
    paraphrase: ['大漠狂风卷动黄昏的战旗', '长河落日浸没孤城的轮廓', '挥鞭直指燕然山的石刻', '待刻下功名光照史册'],
  },
  {
    id: 'q2',
    form: '七言绝句',
    style: '绮丽',
    mood: '明媚',
    season: '春',
    time: '黄昏',
    title: '江南春',
    lines: ['烟雨楼台锁碧纱', '小桥流水过人家', '杏花一树开无主', '落在船头作晚霞'],
    imagery: ['烟雨', '楼台', '小桥', '杏花'],
    paraphrase: ['烟雨里的楼台罩着碧色轻纱', '小桥流水绕过一户户人家', '一树杏花开得无人照管', '花瓣落在船头像一片晚霞'],
  },
  {
    id: 'q3',
    form: '七言绝句',
    style: '婉约',
    mood: '怅惘',
    season: '秋',
    time: '夜',
    title: '秋夜寄怀',
    lines: ['一庭疏雨打梧桐', '灯影依稀照壁空', '欲寄相思无雁字', '半窗凉月半帘栊'],
    imagery: ['疏雨', '梧桐', '灯影', '凉月'],
    paraphrase: ['一院稀疏的雨打着梧桐', '灯影模糊照着空荡的墙壁', '想把相思寄出去却没有雁字', '半窗凉月半帘窗棂'],
  },
  {
    id: 'q4',
    form: '七言绝句',
    style: '冲淡',
    mood: '幽静',
    season: '夏',
    time: '清晨',
    title: '山行',
    lines: ['石径盘云上翠微', '松风一路湿人衣', '忽闻岭外钟声起', '知有禅林隔水扉'],
    imagery: ['石径', '白云', '松风', '钟声'],
    paraphrase: ['石径绕着云雾爬上青翠的山', '一路松风把衣裳都打湿了', '忽然听见山岭外钟声响起', '才知有座寺院隔着水门'],
  },
  {
    id: 'q5',
    form: '七言绝句',
    style: '冲淡',
    mood: '苍茫',
    season: '秋',
    time: '夜',
    title: '江上',
    lines: ['孤帆一片下寒汀', '两岸青山送客亭', '潮落潮生人不见', '月明千里照空冥'],
    imagery: ['孤帆', '寒汀', '青山', '月明'],
    paraphrase: ['一片孤帆驶下寒冷的水汀', '两岸青山送着送别的长亭', '潮起潮落再不见那人身影', '明月照彻千里空阔的江天'],
  },
  {
    id: 'q6',
    form: '七言绝句',
    style: '豪放',
    mood: '慷慨',
    season: '冬',
    time: '夜',
    title: '冬夜',
    lines: ['朔风吹雪满关河', '铁马冰声入梦多', '万里寒光凝一剑', '挑灯看罢夜如何'],
    imagery: ['朔风', '飞雪', '铁马', '孤剑'],
    paraphrase: ['北风吹雪落满关塞河流', '铁马冰河的声音常入梦中', '万里寒光凝聚在一把剑上', '挑亮灯看罢剑，夜已如何'],
  },
  {
    id: 'q7',
    form: '七言绝句',
    style: '冲淡',
    mood: '安乐',
    season: '夏',
    time: '黄昏',
    title: '田家',
    lines: ['豆花初落雨如丝', '竹外鸡鸣午饭迟', '老叟荷锄归去晚', '一溪新月照秧池'],
    imagery: ['豆花', '细雨', '竹篱', '新月'],
    paraphrase: ['豆花刚谢，雨细得像丝', '竹林外鸡叫，午饭吃得迟', '老人扛着锄头回来得晚', '一溪新月照着秧田'],
  },
  {
    id: 'q8',
    form: '七言绝句',
    style: '婉约',
    mood: '幽怨',
    season: '春',
    time: '黄昏',
    title: '春闺',
    lines: ['春深院落锁轻寒', '燕子双飞去又还', '独倚阑干人不语', '落花和雨满庭闲'],
    imagery: ['院落', '燕子', '阑干', '落花'],
    paraphrase: ['春深的院落里锁着一层轻寒', '燕子成双飞去又飞还', '独自倚着阑干一言不发', '落花和雨落满寂静的庭院'],
  },
];

/** 意象词表：词 → 归一化意象 + 季节/时辰线索 */
const LEXICON = [
  { words: ['江', '河', '潮', '汀', '渚', '舟', '帆', '船'], imagery: '寒江', season: '秋', time: '夜' },
  { words: ['灯', '烛', '窗'], imagery: '孤灯', season: null, time: '夜' },
  { words: ['月', '蟾'], imagery: '远月', season: null, time: '夜' },
  { words: ['山', '岭', '峰', '谷'], imagery: '空山', season: null, time: null },
  { words: ['松', '柏'], imagery: '松林', season: null, time: null },
  { words: ['雨', '露', '湿'], imagery: '微雨', season: null, time: null },
  { words: ['雪', '冰', '霜'], imagery: '夜雪', season: '冬', time: null },
  { words: ['风'], imagery: '西风', season: '秋', time: null },
  { words: ['花', '蕊', '香'], imagery: '落花', season: '春', time: null },
  { words: ['柳', '絮'], imagery: '垂柳', season: '春', time: null },
  { words: ['燕'], imagery: '燕子', season: '春', time: '黄昏' },
  { words: ['雁', '莺', '鸦'], imagery: '归雁', season: null, time: '黄昏' },
  { words: ['钟', '寺', '禅'], imagery: '晚钟', season: null, time: '黄昏' },
  { words: ['桥', '渡'], imagery: '小桥', season: null, time: null },
  { words: ['落霞', '晚霞', '霞'], imagery: '落霞', season: '秋', time: '黄昏' },
  { words: ['孤烟', '烟'], imagery: '烟雨', season: null, time: null },
  { words: ['大漠', '沙', '塞', '关'], imagery: '大漠', season: null, time: '黄昏' },
  { words: ['长河', '落日'], imagery: '长河', season: '秋', time: '黄昏' },
  { words: ['旌', '旗', '铁马', '剑', '弓刀'], imagery: '旌旗', season: null, time: null },
  { words: ['梧桐', '芭蕉'], imagery: '梧桐', season: '秋', time: '夜' },
  { words: ['苔', '石径', '泉'], imagery: '苔痕', season: null, time: null },
  { words: ['院', '庭', '阑干', '帘'], imagery: '庭院', season: null, time: null },
  { words: ['春'], imagery: '东风', season: '春', time: null },
  { words: ['夏', '荷', '豆'], imagery: '荷风', season: '夏', time: null },
  { words: ['秋'], imagery: '疏影', season: '秋', time: null },
  { words: ['冬'], imagery: '朔风', season: '冬', time: null },
  { words: ['夜', '更', '宵'], imagery: '夜深', season: null, time: '夜' },
  { words: ['黄昏', '斜阳', '夕阳'], imagery: '斜阳', season: null, time: '黄昏' },
  { words: ['晨', '晓', '早'], imagery: '清晓', season: null, time: '清晨' },
];

const EMOTION_RULES = [
  { keys: ['豪', '壮', '雄', '塞', '战', '剑', '功名', '铁马', '金戈', '大漠', '旌旗'], emotion: '雄浑', style: '豪放' },
  { keys: ['思', '念', '愁', '离', '别', '孤', '独', '忆', '怅', '怨'], emotion: '怅惘', style: '婉约' },
  { keys: ['静', '幽', '淡', '闲', '田', '禅', '山居', '清'], emotion: '冲淡', style: '冲淡' },
  { keys: ['艳', '丽', '春', '花', '霞', '楼'], emotion: '绮丽', style: '绮丽' },
];

const STYLES = ['婉约', '豪放', '冲淡', '绮丽', '雄浑'];
const FORMS = ['五言绝句', '七言绝句'];

/** ① 意象解析 */
export function parseImagery(description, form = '自动', style = '自动') {
  const text = String(description || '').trim();
  const hits = [];
  const seasons = [];
  const times = [];

  for (const entry of LEXICON) {
    if (entry.words.some((w) => text.includes(w))) {
      if (!hits.includes(entry.imagery)) hits.push(entry.imagery);
      if (entry.season) seasons.push(entry.season);
      if (entry.time) times.push(entry.time);
    }
  }

  const supplemented = text.length < 10;
  const filler = ['远月', '西风', '疏影', '晚钟'];
  let i = 0;
  while (hits.length < 3 && i < filler.length) {
    if (!hits.includes(filler[i])) hits.push(filler[i]);
    i += 1;
  }

  const emotion = EMOTION_RULES.find((r) => r.keys.some((k) => text.includes(k))) || {
    emotion: '清寂',
    style: '冲淡',
  };

  const season = pickMost(seasons) || '不分季节';
  const time = pickMost(times) || '不明';

  return {
    core_imagery: hits.slice(0, 5),
    emotion: emotion.emotion,
    season,
    time,
    style_suggestion: STYLES.includes(style) ? style : emotion.style,
    form_suggestion: FORMS.includes(form) ? form : text.length > 26 ? '七言绝句' : '五言绝句',
    supplemented,
  };
}

function pickMost(list) {
  if (!list.length) return null;
  const count = new Map();
  list.forEach((x) => count.set(x, (count.get(x) || 0) + 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** ② 格律成诗（演示：按意象/风格/体裁匹配诗词库） */
export function composePoem(imagery, { form, style, strict = true, avoid = [] } = {}) {
  const wantedForm = FORMS.includes(form) ? form : imagery.form_suggestion || '五言绝句';
  const wantedStyle = STYLES.includes(style) ? style : imagery.style_suggestion;

  const avoidNorm = (avoid || []).map((s) =>
    String(s).replace(/[\s/｜|、,，。；;]/g, ''),
  );
  const scored = POEMS.filter((p) => !avoidNorm.includes(p.lines.join(''))).map((p) => {
    let score = 0;
    if (p.form === wantedForm) score += 5;
    if (p.style === wantedStyle) score += 3;
    if (imagery.season !== '不分季节' && p.season === imagery.season) score += 2;
    if (imagery.time !== '不明' && p.time === imagery.time) score += 1;
    score += p.imagery.filter((im) => imagery.core_imagery.some((c) => c.includes(im) || im.includes(c))).length * 4;
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  const chosen = scored[0] ? scored[0].p : POEMS[0];

  const needLen = chosen.form === '五言绝句' ? 5 : 7;
  const lastChars = [chosen.lines[1].slice(-1), chosen.lines[3].slice(-1)];

  return {
    title: chosen.title,
    lines: [...chosen.lines],
    rhyme_words: lastChars,
    mood: chosen.mood,
    imagery: [...chosen.imagery],
    paraphrase: [...chosen.paraphrase],
    self_check: {
      line_lengths_ok: chosen.lines.every((l) => l.length === needLen),
      // 演示语料已人工校韵，接入模型后以 ③ 程序校验为准
      rhyme_ok: true,
    },
    style: chosen.style,
    form: chosen.form,
    demo: true,
    strict,
  };
}

/** ③ 程序校验 */
export function validatePoem(poem, form) {
  const needLen = form === '七言绝句' ? 7 : 5;
  const issues = [];
  if (!poem || !Array.isArray(poem.lines) || poem.lines.length !== 4) {
    issues.push('句数不为4');
    return { ok: false, issues, needLen };
  }
  poem.lines.forEach((line, idx) => {
    if (typeof line !== 'string' || line.length !== needLen) {
      issues.push(`第${idx + 1}句为${String(line ?? '').length}字`);
    }
  });
  const r1 = poem.lines[1]?.slice(-1);
  const r2 = poem.lines[3]?.slice(-1);
  if (poem.rhyme_words && r1 !== poem.rhyme_words[0]) issues.push('第2句韵脚与声明不一致');
  if (poem.rhyme_words && r2 !== poem.rhyme_words[1]) issues.push('第4句韵脚与声明不一致');
  return { ok: issues.length === 0, issues, needLen };
}
