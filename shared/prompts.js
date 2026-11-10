/**
 * 三段式提示词（服务端与 Edge 运行时共用）
 * ① 意象解析 ② 格律成诗 ③ 校对修复
 */

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

三、立意
- 全诗围绕同一情感基调；意象只能取自输入的意象清单（可舍弃、可微调措辞，不得新增气质相悖的意象）
- 起句写景入题，承句延展，转句蓄势，结句留余味；忌直白说破，忌议论说教收尾
- 四句句式结构应有变化，避免四句同构

四、输出
只输出 JSON，禁止解释文字，禁止 markdown 代码围栏：
{"title": "2~4字诗题", "lines": ["第一句","第二句","第三句","第四句"], "rhyme_words": ["第二句韵脚","第四句韵脚"], "mood": "双字情感基调", "imagery": ["实际入诗的意象"], "paraphrase": ["每句白话意译，各不超过15字，共4项"], "self_check": {"line_lengths_ok": true, "rhyme_ok": true}}

输出前必须自检：逐句数字数（五言=5，七言=7），核对二、四句韵脚，不符合则修改后再输出。

示例：
用户：
【意象清单】孤灯，寒江，夜潮，远月
【情感基调】怅惘
【季节/时辰】秋·夜
【体裁】五言绝句
【风格】婉约
【格律档位】严格
输出：
{"title": "江夜寄远", "lines": ["孤灯照晚汀","寒渚夜潮生","遥忆同舟客","天涯共月明"], "rhyme_words": ["生","明"], "mood": "怅惘", "imagery": ["孤灯","寒渚","夜潮","远月"], "paraphrase": ["一盏孤灯映着傍晚的小洲","寒冷的江渚夜潮暗生","遥想当年同舟共济的人","天涯海角共对一轮明月"], "self_check": {"line_lengths_ok": true, "rhyme_ok": true}}`;

export const FIX_SYSTEM = `你是近体诗校对。你会收到一首绝句和程序检测结果，任务：最小范围修改修复，保持原意与用词风格。

检查优先级：
1. 每句字数：五言=5，七言=7
2. 第二、四句押平声韵（中华新韵，同韵部可通押）
3. 三平尾、现代词、生造词

无问题则原样返回。只输出 JSON，禁止解释，禁止代码围栏：
{"lines": ["修复后四句"], "fixed": false, "issues": []}
有修复时 fixed 置为 true，issues 填写修改说明。`;

export function imageryUser(description, form, style) {
  return `【意境描述】${description}\n【体裁】${form || '自动'}\n【风格】${style || '自动'}`;
}

export function poemUser(imagery, { form, style, strict, avoid }) {
  const base = `【意象清单】${imagery.core_imagery.join('，')}
【情感基调】${imagery.emotion}
【季节/时辰】${imagery.season}·${imagery.time}
【体裁】${form || imagery.form_suggestion}
【风格】${style || imagery.style_suggestion}
【格律档位】${strict ? '严格' : '宽松'}`;
  if (avoid && avoid.length) {
    return `${base}\n【避免重复】上一版本：${avoid.join(' / ')}。请更换主导意象组合与句式结构，情感基调与主题不变。`;
  }
  return base;
}

export function fixUser(lines, form, issues) {
  return `【体裁】${form}
【原诗】${JSON.stringify({ lines, rhyme_words: [lines[1]?.slice(-1), lines[3]?.slice(-1)] })}
【检测问题】${issues.join('；') || '无'}`;
}

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
