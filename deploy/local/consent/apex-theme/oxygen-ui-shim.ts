/**
 * Stands in for '@wso2/oxygen-ui' inside the consent portal container.
 *
 * The portal's main.tsx asks for AcrylicOrangeTheme. vite.docker.config.ts
 * aliases the bare package name to this file, which re-exports the real
 * package unchanged and answers that one name with the Apex theme instead --
 * so the portal is rethemed without editing its upstream source.
 *
 * An explicit named export wins over the same name from `export *`, which is
 * what makes the override take.
 */
export * from '@wso2/oxygen-ui/index'
export { default as AcrylicOrangeTheme } from './apexTheme'
