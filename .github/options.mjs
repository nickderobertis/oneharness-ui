/** @param {string[]} args @param {string[]} names @returns {Record<string, string>} */
export function options(args, names) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!flag.startsWith('--') || !names.includes(flag.slice(2))) throw new Error(`Unexpected argument ${flag}; supply ${names.map(name => `--${name} VALUE`).join(' ')}`);
    const name = flag.slice(2);
    if (name in values) throw new Error(`Duplicate --${name}; supply each option once`);
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`Missing --${name} value; supply ${names.map(name => `--${name} VALUE`).join(' ')}`);
    values[name] = value;
  }
  for (const name of names) if (!(name in values)) throw new Error(`Missing --${name}; supply ${names.map(name => `--${name} VALUE`).join(' ')}`);
  return values;
}
