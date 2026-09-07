/**
 * apps/web gets these declarations free from next-env.d.ts. This package is
 * compiled by plain tsc, which has never heard of CSS Modules, so without this
 * every `import styles from './X.module.css'` is an error and every class
 * reference through it is an `any` that eslint then refuses.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
