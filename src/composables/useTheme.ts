import { watch, type Ref } from "vue";

function getHtmlElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.documentElement;
}

export interface SetThemeClassOptions {
  /**
   * Prefix used to identify existing theme classes on <html>. Any class that
   * starts with this prefix will be removed before applying the new one.
   *
   * Defaults to "theme-".
   */
  prefix?: string;
}

export interface ClearThemeOptions {
  /**
   * Prefix used to identify theme classes to remove. Defaults to "theme-".
   */
  prefix?: string;
  /**
   * Whether to also remove the "dark" class. Defaults to true.
   */
  clearDarkMode?: boolean;
}

/**
 * Theme helper composable for applying global theme and dark mode classes.
 *
 * This composable mutates the `<html>` element's class list (e.g. `theme-foo`,
 * `dark`) and provides small utilities to bind reactive state to those classes.
 */
export function useTheme() {
  /**
   * Apply a theme class (or classes) to <html>, first removing any existing
   * theme-* classes. This does not validate the class name; the consumer is
   * responsible for defining matching CSS.
   *
   * @param className Class name(s) to apply (space-separated), or `null` to only clear.
   * @param options Optional configuration for prefix matching.
   */
  function setThemeClass(
    className: string | null,
    options?: SetThemeClassOptions
  ): void {
    console.log("[useTheme] setThemeClass called with:", className);
    const root = getHtmlElement();
    if (!root) {
      console.log("[useTheme] setThemeClass: no root element found!");
      return;
    }

    const prefix = options?.prefix ?? "theme-";

    const toRemove: string[] = [];
    root.classList.forEach((cls) => {
      if (cls.startsWith(prefix)) toRemove.push(cls);
    });
    toRemove.forEach((cls) => root.classList.remove(cls));

    if (!className) return;

    className
      .split(/\s+/)
      .filter(Boolean)
      .forEach((cls) => root.classList.add(cls));
    console.log("[useTheme] setThemeClass result:", root.classList.toString());
  }

  /**
   * Toggle the global dark mode class on <html>.
   *
   * @param enabled When true, adds the `dark` class; otherwise removes it.
   */
  function setThemeDarkMode(enabled: boolean): void {
    console.log("[useTheme] setThemeDarkMode called with:", enabled);
    const root = getHtmlElement();
    if (!root) {
      console.log("[useTheme] setThemeDarkMode: no root element found!");
      return;
    }
    console.log(
      "[useTheme] setThemeDarkMode: classes before:",
      root.classList.toString()
    );
    if (enabled) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    console.log(
      "[useTheme] setThemeDarkMode: classes after:",
      root.classList.toString()
    );
  }

  /**
   * Clear all theme-related classes from <html>. Useful when logging out
   * to reset the UI to its default state.
   *
   * @param options Optional configuration for prefix matching and dark mode clearing.
   */
  function clearTheme(options?: ClearThemeOptions): void {
    const root = getHtmlElement();
    if (!root) return;

    const prefix = options?.prefix ?? "theme-";
    const clearDarkMode = options?.clearDarkMode ?? true;

    // Remove all theme-* classes
    const toRemove: string[] = [];
    root.classList.forEach((cls) => {
      if (cls.startsWith(prefix)) toRemove.push(cls);
    });
    toRemove.forEach((cls) => root.classList.remove(cls));

    // Remove dark mode class
    if (clearDarkMode) {
      root.classList.remove("dark");
    }
  }

  /**
   * Bind a Ref<string | null> to the theme class on <html>. Whenever the ref
   * changes, the class is reapplied.
   *
   * @param source Reactive class name (or `null` to clear).
   * @param options Optional configuration for prefix matching.
   */
  function bindThemeClass(
    source: Ref<string | null>,
    options?: SetThemeClassOptions
  ): void {
    watch(
      source,
      (value) => {
        setThemeClass(value, options);
      },
      { immediate: true }
    );
  }

  /**
   * Bind a Ref<boolean | string | null> to the global dark mode class. Truthy
   * values like true, "true", and "1" enable dark mode.
   *
   * @param source Reactive value controlling dark mode.
   */
  function bindThemeDarkMode(source: Ref<boolean | string | null>): void {
    watch(
      source,
      (raw) => {
        const enabled =
          raw === true || raw === "true" || raw === "1" ? true : false;
        setThemeDarkMode(enabled);
      },
      { immediate: true }
    );
  }

  return {
    setThemeClass,
    setThemeDarkMode,
    clearTheme,
    bindThemeClass,
    bindThemeDarkMode,
  };
}
