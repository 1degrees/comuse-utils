/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-var-requires */
const visit = require('unist-util-visit');
const u = require('unist-builder');
const modifyChildren = require('unist-util-modify-children');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const yaml = require('js-yaml');
const get = require('lodash/get');
const isEmpty = require('lodash/isEmpty');
const path = require('path');
const fs = require('fs-extra');
const isProd = process.env.NODE_ENV !== 'development';
const fg = require('fast-glob');

let ignoresPattern = null;

function handleDemo(demo) {
  const result = { ...demo };
  try {
    const ast = parser.parse(demo.content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    traverse(ast, {
      enter(path) {
        if (path.isExportNamedDeclaration()) {
          const declarations = get(path.node.declaration, 'declarations', []);
          if (!isEmpty(declarations) && get(declarations[0], 'id.name', '') === 'meta') {
            const properties = get(declarations[0], 'init.properties', []);
            for (const prop of properties) {
              result[prop.key.name] = prop.value.value;
            }
          }
        }
      },
    });
    if (/^\d+-.*/g.test(result.name)) {
      const [order, name] = result.name.split('-');
      result.order = ~~order;
      result.name = name;
    }
    return result;
  } catch (err) {
    return result;
  }
}

const readAndModifyDemos = (vFile, { ignores, needRenderFiles }) => {
  if (vFile.history && vFile.history[0]) {
    const demoDir = path.resolve(vFile.history[0], '../demos');
    if (fs.existsSync(demoDir)) {
      const demos = fs
        .readdirSync(demoDir)
        .filter(file => {
          const filePath = path.resolve(demoDir, file);
          let match = needRenderFiles.length <= 0;
          let needIgnore = false;
          needRenderFiles.forEach(file => {
            if (filePath.includes(file)) match = true;
          });
          ignores.forEach(ignore => {
            if (filePath.includes(ignore)) needIgnore = true;
          });
          return path.extname(file) === '.tsx' && !needIgnore && match;
        })
        .map(file => ({
          name: getNameFromFile(file),
          content: fs.readFileSync(path.resolve(demoDir, file), 'utf-8'),
        }))
        .map(handleDemo)
        .sort((demo1, demo2) => demo1.order - demo2.order);
      return demos;
    }
  }
};

const getNameFromFile = file => {
  const name = path.basename(file, '.tsx');
  if (/^\d+-.*/g.test(name)) {
    return name;
  } else {
    return name.slice(0, 1).toUpperCase() + name.slice(1);
  }
};

const addDemos = (parent, index, vFile, demoAddOpts) => {
  if (vFile.history && vFile.history[0]) {
    const demoDir = path.resolve(vFile.history[0], '../demos');
    let demoNodes = [];
    const asts = [];
    if (fs.existsSync(demoDir)) {
      const demos = readAndModifyDemos(vFile, demoAddOpts, false);
      demos.forEach((demo, i) => {
        const playgroundStrWithThemeProvider = `<Playground>\n <${getNameFromFile(demo.name)}${
          demoAddOpts.demoSuffix
        } />\n</Playground>\n`;
        asts.push(u('jsx', playgroundStrWithThemeProvider));
      });
    }
    if (asts.length > 0) {
      demoNodes.push(u('heading', { depth: 2 }, [u('text', '代码演示')]));
      demoNodes = demoNodes.concat(asts);
      if (index >= 0) {
        parent.children.splice(index, 1, ...demoNodes);
      } else {
        parent.children = parent.children.concat(demoNodes);
      }
    }
  }
};

const defaultOptions = {
  demoSuffix: 'Demo',
  ignores: ['**/styled.tsx'],
  needRenderFiles: [],
};

const muyaRemarkPlugin = (options = defaultOptions) => {
  options = Object.assign(options, defaultOptions);
  if (isProd && !options.ignores.includes('**/*_dev.tsx')) options.ignores.push('**/*_dev.tsx');
  return function transformer(tree, vFile) {
    let meta = {
      column: 1,
      autoDemos: false,
      props: [],
    };
    // 1. 读取 meta
    visit(tree, 'yaml', node => {
      const data = yaml.safeLoad(node.value, 'utf8');
      meta = {
        ...meta,
        ...data,
      };
    });
    if (meta.column > 2) {
      throw Error(`meta.column in ${vFile.history[0]} must be integer 1 or 2`);
    }
    if (meta.autoDemos) {
      const { cwd } = vFile;
      options.needRenderFiles = fg.sync(options.needRenderFiles, {
        cwd,
        onlyFiles: true,
      });
      if (!ignoresPattern) {
        ignoresPattern = fg.sync(options.ignores, {
          cwd,
          onlyFiles: true,
        });
      }
      options.ignores = ignoresPattern;
      // 2. 插入 Demo
      const demoAddOpts = {
        column: meta.column,
        ...options,
      };
      let existInterpolationNode = false;
      modifyChildren(function(node, index, parent) {
        const child = get(node, 'children[0]', {});
        if (node.type === 'paragraph' && child.type === 'text' && child.value === '{Demos}') {
          existInterpolationNode = true;
          addDemos(parent, index, vFile, demoAddOpts);
        }
      })(tree);
      if (!existInterpolationNode) {
        addDemos(tree, -1, vFile, demoAddOpts);
      }
    }
    vFile.disableDoubleRow = meta.disableDoubleRow;
    vFile.disableToc = meta.disableToc;
    // 3. 插入 Props
    return tree;
  };
};

module.exports = muyaRemarkPlugin;
