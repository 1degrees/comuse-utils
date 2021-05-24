const componentName = value => {
  const match = value.match(/^\<\\?(\w+)/);
  return match && match[1];
};

module.exports = {
  componentName,
};
