/**
 * 提示词（服务端与 Edge 运行时共用）
 *
 * 四段式：① 意境润色 ② 意象解析（兼容旧接口） ③ 格律成诗 ④ 逐句校对
 *
 * 🔴 关键约定：成诗那一步必须拿到【意境稿】原文。
 * 只喂 4~5 个意象词，模型只能自己编故事，写出来必然"不搭"。
 */

/* ---------------- ① 意境润色（新增） ---------------- */

export const THEME_SYSTEM = `你是古诗创作应用「诗境」的意境润色引擎。用户只写下三五句零散的话，你要把它扩写成一段"可以照着作诗"的意境稿。

规则：
1. theme 为 60~110 字，纯写景叙事；禁止议论、禁止抒情口号、禁止出现"这首诗/我们/让我们一起"这类元话语
2. 必须落到具体的：地点、时辰、天气、身边之物、正在做的小动作、心里那点说不出的情绪
3. 严格保留用户原话里的实词、人物关系与情境方向。可以补细节，不可以把情绪换掉（用户说"想"，不许改写成"怨"）
4. 用文言偏白的雅语。禁用现代词（手机、时间、记忆、城市、上班、朋友圈），禁用空洞大词（人生、红尘、流年、岁月）
5. imagery 给 3~5 个具体物象（孤灯、寒砧、芦花、疏钟），禁止抽象名词（孤独、思念、回忆）
6. 用户没有说的季节、时辰，按稿子里的景物自行推定，前后一致即可
7. 只输出 JSON，禁止任何解释文字，禁止 markdown 代码围栏

输出格式（字段名固定）：
{"theme":"60~110字的意境稿","imagery":["3~5个具体物象"],"mood":"双字情绪","season":"春|夏|秋|冬|不分季节","time":"夜|黄昏|清晨|正午|不明","scene":"一句话点出人物与处境，不超过20字","form_suggestion":"五言绝句|七言绝句","style_suggestion":"婉约|豪放|冲淡|绮丽|雄浑"}

示例：
用户：想你，秋天，一个人
输出：{"theme":"秋声起时，独坐小楼。案上残茶已冷，檐角一声疏钟浮在薄雾里。阶前桂子落了满地，无人扫。推窗见雁字横过，忽觉山长水远——去岁同看的那轮月，今夜只照着我一个。","imagery":["残茶","疏钟","桂子","雁字","小楼"],"mood":"怅惘","season":"秋","time":"夜","scene":"独坐小楼，故人已远","form_suggestion":"七言绝句","style_suggestion":"婉约"}`;

export function themeUser(description, form, style) {
  const parts = [`【用户原话】${description}`];
  if (form && form !== '自动') parts.push(`【指定体裁】${form}`);
  if (style && style !== '自动') parts.push(`【指定风格】${style}`);
  parts.push('请把上面这段原话润色成意境稿。原话里的每个实词都要能在稿子里找到落点。');
  return parts.join('\n');
}

/* ---------------- ② 意象解析（旧接口，保留） ---------------- */

export const IMAGERY_SYSTEM = `你是古诗创作应用「诗境」的意象解析引擎，唯一任务：从用户的意境描述中提取作诗所需的结构化要素。

规则：
1. 只提取描述中实际存在或明确暗示的意象；若描述不足10字，可补充最贴合意境的1~2个经典意象，并把 supplemented 置为 true
2. 意象必须是具体物象（孤灯、寒江、残月、芦花），禁止抽象名词（孤独、时光、回忆）
3. 若用户已指定体裁或风格，form_suggestion 与 style_suggestion 必须与之一致
4. 只输出 JSON，禁止任何解释文字，禁止 markdown 代码围栏

输出格式（字段名固定）：
{"core_imagery": ["3~5个具体意象"], "emotion": "双字情感基调", "season": "春|夏|秋|冬|不分季节", "time": "夜|黄昏|清晨|正午|不明", "style_suggestion": "婉约|豪放|冲淡|绮丽|雄浑", "form_suggestion": "五言绝句|七言绝句", "supplemented": false}

示例：
用户：秋夜江边，孤舟灯火，思念远人
输出：{"core_imagery": ["孤灯","寒江","夜潮","远月"], "emotion": "怅惘", "season": "秋", "time": "夜", "style_suggestion": "婉约", "form_suggestion": "五言绝句", "supplemented": false}`;

/* ---------------- ③ 格律成诗 ---------------- */

export const POEM_SYSTEM = `你是精通中国古典诗词的诗人，为古诗应用「诗境」创作近体绝句。

一、格律
- 五言绝句每句5字共4句；七言绝句每句7字共4句；句中不含任何标点
- 押韵：第二、四句句尾押平声韵（依中华新韵，同韵部可通押），首句可入韵可不入韵
- 格律档位：
  · 严格：兼顾平仄常格，避免三平尾；意境优先、格律从权，不为凑律生造词语或强行倒装
  · 宽松：只保证字数与二四句押韵，平仄不作硬性要求

二、语言
- 只用文言雅词；禁用现代词汇（时间、世界、记忆、故事、手机等），禁用空洞大词（岁月、人生、时光、红尘、流年）
- 多用具体物象：落霞、孤鹜、疏影、寒砧、芦花、渔火、青苔、半窗
- 动词求精炼传神：照、宿、浸、锁、点、渡、裁、衔

三、立意（最重要）
- 输入会给出一段【意境稿】，那是本次作诗的底本。诗中的人、景、事、小动作，都要能在稿子里找到依据
- 不许另起炉灶：稿子写"独坐、残茶、等一个不回来的人"，就不能写成"泛舟江湖、笑傲风月"
- 稿子里点明的人称与关系（我 / 故人 / 谁）必须保留；稿子里写"今夜"，就不能改成"经年"
- 全诗围绕同一情感基调；意象优先取自【可用意象】，可微调措辞，不得引入气质相悖的物象
- 起句写景入题，承句延展，转句蓄势，结句留余味；忌直白说破，忌议论说教收尾
- 四句句式结构应有变化，避免四句同构

四、输出
只输出 JSON，禁止解释文字，禁止 markdown 代码围栏：
{"title": "2~4字诗题", "lines": ["第一句","第二句","第三句","第四句"], "rhyme_words": ["第二句韵脚","第四句韵脚"], "mood": "双字情感基调", "imagery": ["实际入诗的意象"], "paraphrase": ["每句白话意译，各不超过15字，共4项"], "self_check": {"line_lengths_ok": true, "rhyme_ok": true}}

输出前必须自检：逐句数字数（五言=5，七言=7），核对二、四句韵脚，不符合则修改后再输出。

示例：
用户：
【意境稿】秋声起时，独坐小楼。案上残茶已冷，檐角一声疏钟浮在薄雾里。阶前桂子落了满地，无人扫。推窗见雁字横过，忽觉山长水远——去岁同看的那轮月，今夜只照着我一个。
【可用意象】残茶，疏钟，桂子，雁字，小楼
【情感基调】怅惘
【季节/时辰】秋·夜
【体裁】七言绝句
【风格】婉约
【格律档位】严格
输出：
{"title": "秋夜独坐", "lines": ["小楼独坐听疏钟","案上残茶已不温","桂子满阶无人扫","雁字横空月照门"], "rhyme_words": ["温","门"], "mood": "怅惘", "imagery": ["小楼","疏钟","残茶","桂子","雁字"], "paraphrase": ["独坐小楼听那一声声疏钟","案头的残茶早已凉透","阶前桂子落满也无人打扫","雁字横过天空，只有月光照着门"], "self_check": {"line_lengths_ok": true, "rhyme_ok": true}}`;

/* ---------------- ④ 逐句校对 ---------------- */

export const FIX_SYSTEM = `你是近体诗校对。你会收到一首绝句、逐句检测结果，以及【需改动】的句子编号。

规则：
1. 未列入【需改动】的句子必须一字不改地放回 lines 的对应位置
2. 只换字换词，不改变该句的意思与画面；不许顺手把好句子"润色"一遍
3. 韵脚句（第2、4句）若需改动：改后必须是平声收尾，且与锁定的那个韵脚字同韵部，不允许整首换韵
4. 不得新增现代词（时间、记忆、城市）、不得生造词、不得出现三平尾
5. 只输出 JSON，禁止解释文字，禁止代码围栏

输出格式：
{"lines": ["第1句","第2句","第3句","第4句"], "fixed": true, "notes": ["第3句：原句6字，改为……"]}`;

export function imageryUser(description, form, style) {
  return `【意境描述】${description}\n【体裁】${form || '自动'}\n【风格】${style || '自动'}`;
}

/**
 * 成诗请求体。
 * 🔴 theme 必须真的带上 —— 这是"写得像"的前提。
 */
export function poemUser(imagery, { form, style, strict, avoid, theme } = {}) {
  const lines = [];
  if (theme) lines.push(`【意境稿】${theme}`);

  const words = Array.isArray(imagery?.core_imagery) ? imagery.core_imagery : [];
  if (words.length) lines.push(`【可用意象】${words.join('，')}`);
  if (imagery?.emotion) lines.push(`【情感基调】${imagery.emotion}`);
  if (imagery?.scene) lines.push(`【人物处境】${imagery.scene}`);
  if (imagery?.season || imagery?.time) {
    lines.push(`【季节/时辰】${imagery.season || '不分季节'}·${imagery.time || '不明'}`);
  }
  lines.push(`【体裁】${form || imagery?.form_suggestion || '五言绝句'}`);
  lines.push(`【风格】${style || imagery?.style_suggestion || '冲淡'}`);
  lines.push(`【格律档位】${strict ? '严格' : '宽松'}`);

  const base = lines.join('\n');
  if (avoid && avoid.length) {
    return `${base}\n【避免重复】上一版本：${avoid.join(' / ')}。请更换主导意象组合与句式结构，情感基调与意境稿不变。`;
  }
  return base;
}

/**
 * 校对请求体。
 * @param {string[]} lines  原诗四句
 * @param {string}   form   体裁
 * @param {string[]} issues 程序检测到的问题（人话）
 * @param {number[]} badIdx 需要改的句子下标（0 起）
 */
export function fixUser(lines, form, issues, badIdx = []) {
  const asIdx = (i) => `第${i + 1}句`;
  const bad = badIdx.length ? badIdx : [0, 1, 2, 3];
  const rhyme = lines[1]?.slice(-1) || '';

  const parts = [
    `【体裁】${form}`,
    `【原诗】${JSON.stringify(lines)}`,
    `【检测问题】${issues.join('；') || '无'}`,
    `【需改动】${bad.map(asIdx).join('、')}`,
    `【未列入的一律不改】${[0, 1, 2, 3]
      .filter((i) => !bad.includes(i))
      .map(asIdx)
      .join('、') || '无'}`,
  ];
  if (rhyme) {
    parts.push(`【锁定韵脚】第2句「${rhyme}」，第4句必须与它同韵部；若第2句本身要改，改后仍须与此韵相同`);
  }
  parts.push('请只重写【需改动】的句子，按原顺序返回完整四句。');
  return parts.join('\n');
}

/* ---------------- 解析 ---------------- */

/** 从模型返回文本中稳健地提取 JSON（含常见格式修复） */
export function parseJson(text) {
  const raw = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/```(json)?/gi, '')
    .trim();
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('模型返回中未找到 JSON');

  const body = raw.slice(s, e + 1);
  try {
    return JSON.parse(body);
  } catch {
    const repaired = body
      // 去掉行内注释
      .replace(/^\s*\/\/.*$/gm, '')
      // 中文标点误用（仅结构位置）
      .replace(/：(?=\s*["[{\d])/g, ':')
      .replace(/，(?=\s*["[{\d])/g, ',')
      // 尾随逗号
      .replace(/,\s*([}\]])/g, '$1')
      // 控制字符
      .replace(/[\u0000-\u001f]+/g, ' ');
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`模型返回不是合法 JSON：${body.slice(0, 80)}…`);
    }
  }
}

/** 模型偶尔把"拒绝执行"当成答案交回来，长度合格但完全不是意境 */
const REFUSAL = /(抱歉|对不起|很遗憾|无法(完成|提供|协助|满足)|不能(完成|提供)|作为(一个)?(AI|人工智能|语言模型)|我(不能|无法|不便)|请(提供|告诉)我更|需要更多(信息|细节))/;

const HAN = /^[\u4e00-\u9fa5]{1,6}$/;

/**
 * 解析意境稿。输入可以是模型原文（字符串）或已解析的对象。
 * 不合格一律抛错，由上层决定降级 —— 绝不把道歉语当意境用。
 */
export function parseTheme(input) {
  const raw = typeof input === 'string' ? parseJson(input) : input || {};
  const theme = String(raw.theme || raw.theme_text || raw.draft || '').trim();
  if (!theme) throw new Error('意境稿为空');
  if (REFUSAL.test(theme)) throw new Error('模型返回的是拒绝执行，不是意境稿');
  if (theme.length < 20) throw new Error(`意境稿过短（${theme.length} 字）`);
  if (theme.length > 220) throw new Error(`意境稿过长（${theme.length} 字）`);

  const seq = Array.isArray(raw.imagery)
    ? raw.imagery
    : Array.isArray(raw.core_imagery)
      ? raw.core_imagery
      : [];
  const imagery = seq
    .map((x) => String(x || '').trim())
    .filter((x) => HAN.test(x))
    .slice(0, 5);
  if (!imagery.length) throw new Error('意境稿没有给出可用意象');

  const pick = (v, list, dft) => (list.includes(String(v || '').trim()) ? String(v).trim() : dft);

  return {
    theme,
    imagery,
    mood: String(raw.mood || raw.emotion || '清寂').slice(0, 2),
    season: pick(raw.season, ['春', '夏', '秋', '冬', '不分季节'], '不分季节'),
    time: pick(raw.time, ['夜', '黄昏', '清晨', '正午', '不明'], '不明'),
    scene: String(raw.scene || '').slice(0, 30),
    form_suggestion: pick(raw.form_suggestion, ['五言绝句', '七言绝句'], ''),
    style_suggestion: pick(raw.style_suggestion, ['婉约', '豪放', '冲淡', '绮丽', '雄浑'], ''),
  };
}
