/* eslint-disable no-console */
/* eslint-disable max-len */
const path = require('path');
const glob = require('glob');
const fse = require('fs-extra');
const sortFile = require('./sort-files');

const componentsDest = path.resolve(__dirname, './pages/fec/modules');

function newLineReplacer(str) {
  return str.replace(/<br \/>\s+/gm, (str) => {
    const spacers = str.match(/\s/gm || []);
    return str.replace(/<br \/>\s/, `<br/>${spacers.map(() => `<span className=@@spacerPlaceholder></span>`).join('')}`);
  });
}

const propTypeGeneratorMapper = {
  string: primitiveGenerator,
  number: primitiveGenerator,
  bool: primitiveGenerator,
  fuc: primitiveGenerator,
  array: primitiveGenerator,
  union: unionGenerator,
  node: primitiveGenerator,
  any: (type, file) => {
    console.warn('\x1b[33m%s\x1b[0m', `Warn: you are using "any" prop type in ${file}. Please avoid using any in your proptypes.`);
    return primitiveGenerator(type);
  },
  func: primitiveGenerator,
  arrayOf: arrayOfGenerator,
  shape: shapeGenerator,
  instanceOf: ({ value }) => value,
  enum: enumGenerator,
  custom: ({ raw }) => raw,
  object: primitiveGenerator,
  undefined: primitiveGenerator,
  element: primitiveGenerator,
};

function primitiveGenerator({ name }) {
  return `\`${name}\``;
}

function enumGenerator({ value }) {
  if (Array.isArray(value)) {
    return value.map(({ value }) => value).join(' &#124; ');
  }

  if (typeof value === 'string') {
    return value.replace(/\|/gm, '&#124;').replace(/\{/gm, '&#123;').replace(/\}/gm, '&#125;').replace(/\s/gm, '');
  }

  return value;
}

function unionGenerator({ value }) {
  return `${value.map((type) => propTypeGeneratorMapper[type.name](type)).join(' &#124; ')}`;
}

function arrayOfGenerator({ value }) {
  return `<code>Array of:</code> ${propTypeGeneratorMapper[value.name](value)}`;
}

function shapeGenerator({ value }) {
  const shape = Object.entries(value).reduce(
    (acc, [name, value]) => ({
      ...acc,
      [`${name}${value.required ? '&#42;' : ''}`]: propTypeGeneratorMapper[value.name](value),
    }),
    {}
  );
  return `<code>${newLineReplacer(
    JSON.stringify(shape, null, 2)
      .replace(/\n/gm, '<br />')
      .replace(/("|\\")/gm, '')
      .replace(/:/gm, ': ')
      .replace(/,/gm, ', ')
  )}</code>`;
}

function getPropType(propType, file, { description, name }) {
  if (description && description.includes('@extensive')) {
    return `Check the full prop type definition [here](#${name}).`;
  }

  if (description && description.includes('@reference')) {
    return `<code>Object</code>`;
  }

  if (typeof propType === 'string') {
    return propType;
  }

  if (typeof propType === 'object') {
    const { value, name, ...rest } = propType;
    try {
      return `${propTypeGeneratorMapper[propType.name](propType, file)}`;
    } catch (error) {
      console.warn('\x1b[33m%s\x1b[0m', `Warn: Error while generating prop types in ${file}.`);
      console.warn('\x1b[33m%s\x1b[0m', JSON.stringify({ rest, value, propType, error }, null, 2));
    }
  }

  return typeof propType === 'object'
    ? `<code>${newLineReplacer(JSON.stringify(propType, null, 2).replace(/\n/gm, '<br />'))}</code>`
    : `<code>${propType}</code>`;
}

function generateDefaultValue(value) {
  if (value.defaultValue) {
    return `\`${newLineReplacer(
      JSON.stringify(value.defaultValue.value, null, 2)
        .replace(/\\n/gm, '  ')
        .replace(/(^"|\^"|"$|"(?=\{)|(?<=})")/gm, '')
    ).replace(/((\\")(?=\s)|(?<==)(\\"))/gm, '"')}\``;
  }

  return '';
}

function generateComponentDescription(description) {
  const result = { value: description };
  if (description?.includes('@deprecated')) {
    result.deprecated = true;
    result.value = result.value.replace('@deprecated', '');
  }

  return result;
}

function generateMDImports({ examples, description, extensiveProps }) {
  let imports = '';
  if (examples.length > 0) {
    imports = imports.concat(`import ExampleComponent from '@docs/example-component'`, '\n');
  }

  if (extensiveProps.length > 0) {
    imports = imports.concat(`import ExtensiveProp from '@docs/extensive-prop'`, '\n');
  }

  if (description.deprecated) {
    imports = imports.concat(`import DeprecationWarn from '@docs/deprecation-warn'`, '\n\n', '<DeprecationWarn />', '\n');
  }

  return imports;
}

function generatePropDescription(prop) {
  if (!prop.description) {
    return '';
  }

  const result = { ...prop };

  if (prop.description && prop.description.includes('@extensive')) {
    result.description.replace('@extensive', '');
  }

  if (prop.description.includes('@reference')) {
    result.reference = true;
    result.description = result.description.replace('@reference', '');
  }

  return result.description;
}

function getExtensiveProps(props) {
  if (!props) {
    return [];
  }

  const result = Object.entries(props)
    .filter(([, value]) => value.description && value.description.includes('@extensive'))
    .map(([name, value]) => {
      return { name, value: value.type };
    });

  return result;
}

async function generateMD(file, API) {
  const packageName = sortFile(file);
  const name = file.split('/').pop().replace('.js', '');
  const examples = glob.sync(path.resolve(__dirname, `./examples/${name}/*.js`));
  const description = generateComponentDescription(API.description);
  const extensiveProps = getExtensiveProps(API.props, file);
  const imports = generateMDImports({ examples, description, extensiveProps });

  const content = `${imports}
# ${API.displayName}${
    description.value
      ? `
${description.value}`
      : ''
  }${
    examples.length > 0
      ? `
${examples
  .map((example) => {
    const fileName = example
      .split('/')
      .pop()
      .replace(/\.(js|tsx?)&/, '');
    return `<ExampleComponent source="${name}/${fileName}" name="${fileName.replace('-', ' ')}" />`;
  })
  .join('')}`
      : ''
  }

${
  API.props
    ? `## Props

|name|type|default|description|
|----|----|-------|-----------|
${Object.entries(API.props)
  .map(
    ([name, value]) => `|${name}${value.required ? `&#42;` : ''}|${getPropType(value.type, file, { name, ...value }).replace(
      /@@spacerPlaceholder/gm,
      '"default-prop-spacer"'
    )}|${generateDefaultValue(value)}|${generatePropDescription(value)}|
`
  )
  .join('')}`
    : '\n'
}

${extensiveProps.map((data) => {
  return `### <a name="${data.name}"></a>${data.name}

<ExtensiveProp data={${JSON.stringify(data.value)}} />`;
})}
`;
  if (!fse.existsSync(componentsDest)) {
    fse.mkdirSync(componentsDest);
  }

  if (!fse.existsSync(`${componentsDest}/${packageName}`)) {
    fse.mkdirSync(`${componentsDest}/${packageName}`);
  }

  return fse.writeFile(`${componentsDest}/${packageName}/${name}.md`, content);
}

module.exports = generateMD;
