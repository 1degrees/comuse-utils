/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-var-requires */
const is = require('unist-util-is');
const u = require('unist-builder');
const get = require('lodash/get');
const flatten = require('lodash/flatten');
const isEmpty = require('lodash/isEmpty');
const parser = require('@babel/parser');
const generator = require('@babel/generator').default;
const types = require('@babel/types');
const traverse = require('@babel/traverse').default;
const fs = require('fs-extra');
const path = require('path');
const { componentName } = require('./jsx');
const { format } = require('./format');
const doczPkgName = 'docz';
const doczDefaultImports = ['Playground', 'Props'];
const { getImportsVariables } = require('docz-utils/lib/imports');
const fg = require('fast-glob');
const ts = require('typescript');
let baseUrl = '';
let navigation = false;
let pattens = null;
const isProd = process.env.NODE_ENV !== 'development';

const traverseOnImports = fn => node => {
  try {
    const ast = parser.parse(node.value, { sourceType: 'module' });
    let populated = [];

    traverse(ast, {
      enter(path) {
        if (path.isImportDeclaration()) {
          populated = populated.concat(fn(path));
          return;
        }
      },
    });

    return populated;
  } catch (err) {
    return [];
  }
};

const modifyDoczImports = traverseOnImports(path => {
  const { specifiers = [], source = {} } = path.node;
  if (source.value === doczPkgName) {
    const names = new Set([
      ...doczDefaultImports.map(name => ({
        local: name,
        imported: name,
      })),
      ...specifiers
        .filter(specifier => !doczDefaultImports.includes(specifier.imported.name))
        .map(specifier => ({
          local: specifier.local.name,
          imported: specifier.imported.name,
        })),
    ]);
    path.node.specifiers = [...names].map(({ local, imported }) =>
      types.importSpecifier(types.identifier(local), types.identifier(imported)),
    );
  }
  return get(generator(path.node), 'code');
});

const addDoczComponents = (tree, vFile) => {
  const existDoczImport = tree.children
    .filter(node => is(node, 'import'))
    .some(node => node.value.includes(doczPkgName));

  if (existDoczImport) {
    tree.children
      .filter(node => is(node, 'import'))
      .forEach(node => {
        node.value = modifyDoczImports(node).join('\n');
      });
  }
};

const getNameFromFile = file => {
  let name = path.basename(file, '.tsx');
  if (/^\d+-.*/g.test(name)) {
    name = name.split('-')[1];
  }
  return name.slice(0, 1).toUpperCase() + name.slice(1);
};

const addDemoImports = (tree, vFile, { demoSuffix, ignores }) => {
  if (vFile.history && vFile.history[0]) {
    const demoDir = path.resolve(vFile.history[0], '../demos');
    if (fs.existsSync(demoDir)) {
      const demos = fs
        .readdirSync(demoDir)
        .filter(file => path.extname(file) === '.tsx' && !ignores.includes(file));
      demos.forEach(demo => {
        const node = u(
          'import',
          `import ${getNameFromFile(demo)}${demoSuffix} from './demos/${demo}';`,
        );
        tree.children.unshift(node);
      });
    }
  }
};

let suffix = 1000;

function handleDemo(result, { name, content }) {
  try {
    result[name] = {};
    let demoComName = 'Demo';
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    traverse(ast, {
      enter(path) {
        if (path.isExportDefaultDeclaration()) {
          demoComName = get(path, 'node.declaration.id.name', `Demo${suffix++}`);
        }
        if (path.isExportNamedDeclaration()) {
          const declarations = get(path.node.declaration, 'declarations', []);
          if (!isEmpty(declarations) && get(declarations[0], 'id.name', '') === 'meta') {
            const properties = get(declarations[0], 'init.properties', []);
            for (const prop of properties) {
              if (prop.value.type === 'TemplateLiteral') {
                result[name][prop.key.name] = prop.value.quasis[0].value.cooked;
              } else {
                result[name][prop.key.name] = prop.value.value;
              }
            }
            path.remove();
          }
        }
      },
    });
    result[name].__demo =
      get(generator(ast), 'code') +
      `
ReactDOM.render(<${demoComName} />, mountNode);`;
    return result;
  } catch (err) {
    console.log(err);
    result[name].__demo = content;
    return result;
  }
}

function readAndModifyDemos(vFile, { ignores }) {
  if (vFile.history && vFile.history[0]) {
    const demoDir = path.resolve(vFile.history[0], '../demos');
    if (fs.existsSync(demoDir)) {
      const demos = fs
        .readdirSync(demoDir)
        .filter(file => path.extname(file) === '.tsx' && !ignores.includes(file))
        .map(file => ({
          name: getNameFromFile(file),
          content: fs.readFileSync(path.resolve(demoDir, file), 'utf-8'),
        }))
        .reduce(handleDemo, {});
      return demos;
    }
  }
}

const isPlayground = name => name === 'Playground';

const addComponentsProps = (
  demos,
  options,
  toc,
  titles,
  demosInfo,
  scopes,
  tocDeep,
) => async node => {
  if (node.tagName === `h${tocDeep}`) {
    if (node.children && node.children.length > 0) {
      const value = node.children[0] && node.children[0].value;
      if (value) toc.push(`${value}`);
    }
    return;
  }
  const name = componentName(node.value);
  const tagOpen = new RegExp(`^\\<${name}`);
  if (isPlayground(name)) {
    for (const [demoName, demo] of Object.entries(demos)) {
      const demoTagOpen = new RegExp(`<${demoName}${options.demoSuffix}`);
      if (demoTagOpen.exec(node.value)) {
        toc.push(demo.title);
        titles.push(demo.title);
        demosInfo.push({
          id: demo.id,
          url: `${baseUrl}#/${demo.id}`,
          title: demo.title,
          desc: demo.desc,
        });
        const demoCode = await format(demo.__demo);
        const jsCode = ts.transpileModule(demoCode, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            jsx: ts.JsxEmit.Preserve,
          },
        }).outputText;
        const scope = `{props: this ? this.props : props,${scopes.join(',')}}`;
        node.value = node.value.replace(
          tagOpen,
          `<${name} style={{ title: '${
            demo.title && demo.title !== 'undefined' ? escape(demo.title) : ''
          }', desc: '${demo.desc && demo.desc !== 'undefined' ? escape(demo.desc) : ''}', id: '${
            demo.id && demo.id !== 'undefined' ? String(demo.id).trim() : ''
          }', __demo: '${escape(demoCode)}', needCodeSandbox: ${
            options.codeSandbox
          },code: '<${demoName}Demo/>', scope: ${scope}, jsCode: '${escape(jsCode)}'}}`,
        );
        break;
      }
    }
  }
};

function handleMedian(array) {
  const median = Math.round(array.length / 2);
  const left = array.slice(0, median);
  const right = array.slice(median);
  return [left, right];
}

// 处理文档双页布局
function handleDemoStyle(children, disableDoubleRow, disableMobile) {
  if (!disableMobile) {
    const tagOpen = new RegExp(`^\\<Playground`);
    let start = -1;
    let values = [];
    let indexs = [];
    children.forEach((node, index) => {
      if (tagOpen.exec(node.value)) {
        if (start === -1) start = index;
        values.push(node.value);
        indexs.push(index);
      }
    });
    for (let i = children.length - 1; i >= 0; i--) {
      if (indexs.includes(i)) {
        children.splice(i, 1);
      }
    }
    children.splice(start, 0, {
      type: 'jsx',
      value: `
  <CodeBoxRow>
    <CodeBoxCol className="code-boxes-mobile">${values.join('')}</CodeBoxCol>
  </CodeBoxRow>
  `,
    });
  } else if (!disableDoubleRow) {
    const tagOpen = new RegExp(`^\\<Playground`);
    let start = -1;
    let values = [];
    let indexs = [];
    children.forEach((node, index) => {
      if (tagOpen.exec(node.value)) {
        if (start === -1) start = index;
        values.push(node.value);
        indexs.push(index);
      }
    });
    for (let i = children.length - 1; i >= 0; i--) {
      if (indexs.includes(i)) {
        children.splice(i, 1);
      }
    }
    const [left, right] = handleMedian(values);
    children.splice(start, 0, {
      type: 'jsx',
      value: `
  <CodeBoxRow>
    <CodeBoxCol>${left.join('')}</CodeBoxCol>
    <CodeBoxCol>${right.join('')}</CodeBoxCol>
  </CodeBoxRow>
  `,
    });
  }
}

// 处理右侧导航栏布局
function handleNavigationLayout(children, toc, titles, disableDoubleRow, disableToc = false) {
  // 每个 demo 的 title 已经在 handleDemoStyle 阶段提取出来了
  // 处理双列 demo 时导航顺序问题
  if (!disableDoubleRow) {
    if (toc.length > 0) {
      const indexs = [];
      titles.forEach(title => {
        indexs.push(toc.findIndex(ele => ele === title));
      });
      const [left, right] = handleMedian(titles);
      titles = [];
      for (let index = 0; index < right.length; index++) {
        titles.push(left[index]);
        titles.push(right[[index]]);
      }
      if (left.length > right.length) {
        titles.push(left[right.length]);
      }
      indexs.forEach((index, i) => {
        toc[index] = titles[i];
      });
    }
  }
  if (navigation && !disableToc && toc.length > 0) {
    children.unshift({ type: 'jsx', value: `<Navigation titles={${JSON.stringify(toc)}} />` });
  }
}

// 处理右侧手机模拟框
function handleMobileLayout(children, demosInfo, disableMobile) {
  if (!disableMobile && demosInfo.length > 0) {
    children.unshift({
      type: 'jsx',
      value: `<Mobile infos={${JSON.stringify(demosInfo)}} />`,
    });
  }
}

// disableDoubleRow 从 vfile 中读取的，也就是 yaml 中的配置
// vfile 相关的处理请参考 remark-muya 这个包
function injectPlayground(
  tree,
  demos,
  options,
  scopes,
  { disableDoubleRow, disableToc, disableMobileType },
) {
  let toc = [];
  let titles = [];
  let demosInfo = [];
  const { tocDeep } = options;
  const nodes = tree.children
    .filter(node => is(node, 'jsx') || node.tagName === `h${tocDeep}`)
    .map(addComponentsProps(demos, options, toc, titles, demosInfo, scopes, tocDeep));

  return Promise.all(nodes).then(() => {
    const children = tree.children;
    const disableDouble = !options.demoDoubleRow || disableDoubleRow;
    const disableMobile = !options.isMobile || disableMobileType;
    handleNavigationLayout(children, toc, titles, disableDouble, disableToc);
    handleMobileLayout(children, demosInfo, disableMobile);
    handleDemoStyle(children, disableDouble, disableMobile);
    tree.children = children;
    return tree;
  });
}

const defaultOptions = {
  demoSuffix: 'Demo',
  ignores: ['styled.tsx'],
  includes: [],
  demosBaseUrl: 'http://localhost:8080/',
  needToc: true,
  isMobile: true,
  tocDeep: 2,
  demoDoubleRow: false,
  codeSandbox: false,
};

/**
 * 插件配置，更改配置需要重新执行命令
 * demoSuffix： Demo 组件后缀
 * ignores：忽略文件
 * includes：根目录下需要渲染的文件夹中的 demo，具体规则请查看 fast-glob
 * needToc：是否开启文档右侧导航栏
 * tocDeep: toc 提取标题的层级，3 -> H3，如果有 demo 会自动提取 demo 的 title
 * demoDoubleRow：是否开启 Demo 双列布局，传入 false 即可全局关闭
 * codeSandbox：是否开启 demo 使用 codeSandbox
 */
const muyaRehypePlugin = (options = defaultOptions) => {
  options = Object.assign(defaultOptions, options);
  if (isProd) options.ignores.push('_dev.tsx');
  return function transformer(tree, vFile) {
    const { history, cwd } = vFile;
    const { includes } = options;
    if (history && history.length > 0) {
      let match = false;
      if (!pattens) {
        pattens = fg.sync(includes, {
          cwd,
          onlyFiles: false,
        });
      }
      for (let index = 0; index < pattens.length; index++) {
        const patten = new RegExp(pattens[index]);
        if (patten.test(history[0])) {
          match = true;
          break;
        }
      }
      if (pattens.length === 0 || match) {
        // demos链接
        baseUrl = options.demosBaseUrl;
        // 是否开启导航模式
        navigation = options.needToc;
        // 1. 插入 Playground 和 Props
        addDoczComponents(tree, vFile, options);
        // 2. 插入 Demos import
        addDemoImports(tree, vFile, options);
        // 3. 读取并修改 Demos 的代码
        const demos = readAndModifyDemos(vFile, options);
        // 4. 将 demo 代码注入到 Playground
        const importNodes = tree.children.filter(node => is(node, 'import'));
        const scopes = flatten(importNodes.map(getImportsVariables));
        if (demos) {
          return injectPlayground(tree, demos, options, scopes, vFile);
        } else {
          let toc = [];
          const { tocDeep } = options;
          const nodes = tree.children
            .filter(node => is(node, 'jsx') || node.tagName === `h${tocDeep}`)
            .map(node => {
              if (node.tagName === `h${tocDeep}`) {
                if (node.children && node.children.length > 0) {
                  const value = node.children[0] && node.children[0].value;
                  if (value) toc.push(`${value}`);
                }
              }
              return node;
            });

          return Promise.all(nodes).then(() => {
            const children = tree.children;
            handleNavigationLayout(
              children,
              toc,
              [],
              !options.demoDoubleRow || vFile.disableDoubleRow,
              vFile.disableToc,
            );
            tree.children = children;
            return tree;
          });
        }
      }
    }
  };
};

module.exports = muyaRehypePlugin;
