/**
 * 本地格律引擎纯函数回归（不联网、不起服务、不耗额度）
 *
 * 为什么单独测：线上出过一次「选七言、出来一串五言+七言混排」的事故，
 * 根因全在 composePoem / patchedLines 这两个纯函数里，
 * 用穷举比写一个场景更省钱也更难漏。
 */
import {
  POEMS,
  parseImagery,
  composePoem,
  validatePoem,
  patchedLines,
  syncRhymeWords,
  localTheme,
} from '../server/poems.js';

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name + (extra ? ` → ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` → ${extra}` : ''}`);
  }
}

const FORMS = ['五言绝句', '七言绝句'];
const STYLES = ['婉约', '豪放', '冲淡', '绮丽', '雄浑'];
const DESCS = [
  '雨后空山，松间清泉',
  '大漠风沙，孤城落日',
  '秋夜江边，孤舟灯火',
  '春深小院，燕子双飞',
  '想你，秋天，一个人',
];

/* ---------------- 1. 库存本身合规 ---------------- */
console.log('\n[1] 库存 16 首自身是否合律');
ok('库存共 16 首', POEMS.length === 16, `n=${POEMS.length}`);
ok(
  '五言、七言各 8 首',
  FORMS.every((f) => POEMS.filter((p) => p.form === f).length === 8),
  FORMS.map((f) => `${f}:${POEMS.filter((p) => p.form === f).length}`).join(' '),
);
const badSelf = POEMS.filter((p) => {
  const need = p.form === '七言绝句' ? 7 : 5;
  return p.lines.length !== 4 || p.lines.some((l) => l.length !== need);
});
ok('每首都是四句且字数统一', badSelf.length === 0, badSelf.map((p) => p.id).join(','));
// 注意：二、四句末字**不必相同**（生 / 明 同韵部），所以这里查的是
// 「把实际句尾当声明去校验能通过」，而不是末字是否相等
const badSelfCheck = POEMS.filter((p) => {
  const poem = { lines: p.lines, rhyme_words: [p.lines[1].slice(-1), p.lines[3].slice(-1)] };
  return !validatePoem(poem, p.form).ok;
});
ok('每首拿实际句尾当声明都能通过校验', badSelfCheck.length === 0, badSelfCheck.map((p) => p.id).join(','));

/* ---------------- 2. 明确体裁必须被尊重（核心回归） ---------------- */
console.log('\n[2] 明确点了体裁，就必须给这个体裁');
const violations = [];
for (const desc of DESCS) {
  for (const form of FORMS) {
    for (const style of STYLES) {
      const im = parseImagery(desc, form, style);
      const p = composePoem(im, { form, style, strict: true, avoid: [] });
      const v = validatePoem(p, form);
      if (p.form !== form || !v.ok) {
        violations.push(`「${desc}」${form}/${style} → ${p.title}(${p.form}) ${v.issues.join(';')}`);
      }
    }
  }
}
ok(
  `${DESCS.length * FORMS.length * STYLES.length} 种组合都给出所选体裁且合律`,
  violations.length === 0,
  violations.slice(0, 3).join(' | '),
);

/* ---------------- 3. 事故现场逐字复现 ---------------- */
console.log('\n[3] 线上那条混排稿（雨后空山 + 七言 + 冲淡）');
const imCase = parseImagery('雨后空山，松间清泉', '七言绝句', '冲淡');
const pCase = composePoem(imCase, { form: '七言绝句', style: '冲淡', strict: true, avoid: [] });
ok('选中的是七言诗', pCase.form === '七言绝句', `${pCase.title}:${pCase.form}`);
ok('四句都是 7 字', pCase.lines.every((l) => l.length === 7), pCase.lines.map((l) => `${l}${l.length}`).join('/'));
ok('校验通过', validatePoem(pCase, '七言绝句').ok);
ok('没有 form_downgraded 标记', pCase.formDowngraded === false);

/* ---------------- 4. 补句不许把两种体裁缝在一起 ---------------- */
console.log('\n[4] 整首字数就不对时，不许补句');
const fiveAsSeven = { lines: ['空山新雨歇', '松径落云深', '独坐听流泉', '苔痕上石心'], style: '冲淡' };
const patched = patchedLines(fiveAsSeven, 7, [0, 1, 2, 3]);
ok('五言底稿按七言口径补 → 一处都不补', patched.patches.length === 0, `patches=${patched.patches.length}`);
ok(
  '句子原样返回（没被改成长短句）',
  patched.lines.join('/') === fiveAsSeven.lines.join('/'),
  patched.lines.join('/'),
);
const mixed = patchedLines(fiveAsSeven, 7, [0, 2]);
ok('只坏两句但都是五言 → 仍不补', mixed.patches.length === 0, `patches=${mixed.patches.length}`);

console.log('\n[5] 老行为仍在：只坏第 3 句时补一句，其余不动');
const onlyThird = {
  lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟', '天涯共月明'],
  style: '婉约',
  imagery: ['孤灯', '寒渚'],
};
const patched3 = patchedLines(onlyThird, 5, [2]);
ok('补了 1 处', patched3.patches.length === 1, `patches=${patched3.patches.length}`);
ok('补的正是第 3 句', patched3.patches[0]?.index === 2);
ok('补完是 5 字', patched3.lines[2].length === 5, patched3.lines[2]);
ok(
  '其余三句一字未动',
  [0, 1, 3].every((i) => patched3.lines[i] === onlyThird.lines[i]),
  patched3.lines.join('/'),
);
ok('没有把韵脚换掉', patched3.lines[1].slice(-1) === '生' && patched3.lines[3].slice(-1) === '明');

/* ---------------- 6. 校验的坏句定位 ---------------- */
console.log('\n[6] 校验报的坏句位置要对得上');
const v6 = validatePoem({ lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟', '天涯共月明'] }, '五言绝句');
ok('第 3 句被点名', v6.bad.length === 1 && v6.bad[0] === 2, `bad=${v6.bad}`);
ok('问题描述里带字数', v6.issues.some((s) => s.includes('4')), v6.issues.join(';'));
const v6b = validatePoem({ lines: ['a', 'b', 'c'] }, '五言绝句');
ok('句数不对时四句全算坏', v6b.bad.length === 4);

/* ---------------- 7. 韵脚声明纠偏 ---------------- */
console.log('\n[7] 模型把韵脚写错、句子是对的 → 改声明不改诗');
const wrongDecl = { lines: ['孤灯照晚汀', '寒渚夜潮生', '遥忆同舟客', '天涯共月明'], rhyme_words: ['平', '亮'] };
const changed = syncRhymeWords(wrongDecl);
ok('被识别为需要纠正', changed === true);
ok('韵脚改成实际句尾', wrongDecl.rhyme_words.join('') === '生明', wrongDecl.rhyme_words.join(''));
ok('句子没动', wrongDecl.lines[1] === '寒渚夜潮生');

const v7 = validatePoem({ lines: wrongDecl.lines, rhyme_words: ['平', '亮'] }, '五言绝句');
ok('声明不一致只算提示，不把句子判成坏句', v7.ok === false && v7.bad.length === 0, `bad=${v7.bad}`);
const v7b = validatePoem(wrongDecl, '五言绝句');
ok('同步声明后校验通过', v7b.ok === true, v7b.issues.join(';'));

/* ---------------- 8. 本地润色仍可用 ---------------- */
console.log('\n[8] 润色降级模板');
for (const form of FORMS) {
  const t = localTheme('雨后空山，松间清泉', form, '冲淡');
  ok(`${form} 的模板稿有 60 字以上`, String(t.theme).length >= 60, `len=${String(t.theme).length}`);
  ok(`${form} 的模板稿不含道歉语`, !/抱歉|无法|不能/.test(t.theme));
  ok(`${form} 给出 1~6 个意象`, t.imagery.length >= 1 && t.imagery.length <= 6, `${t.imagery.join(',')}`);
}

console.log('');
console.log('='.repeat(52));
console.log(`通过 ${pass} 项 · 失败 ${fails.length} 项`);
if (fails.length) {
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fails.length ? 1 : 0);
