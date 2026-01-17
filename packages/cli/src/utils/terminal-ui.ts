/**
 * Terminal UI utilities for beautiful CLI output.
 */

import ora, { type Ora } from 'ora';
import pc from 'picocolors';

export const colors = {
    success: pc.green,
    error: pc.red,
    warn: pc.yellow,
    info: pc.cyan,
    dim: pc.dim,
    bold: pc.bold,
};

export const icons = {
    success: '✓',
    error: '✗',
    warn: '⚠',
    info: 'ℹ',
};

/**
 * Prints a bordered header box to the terminal.
 * @param title - The header title text
 */
export function printHeader(title: string): void {
    const width = 48;
    const padding = Math.max(0, width - title.length - 4);
    console.log(pc.cyan('┌' + '─'.repeat(width - 2) + '┐'));
    console.log(
        pc.cyan('│') +
            '  ' +
            pc.bold(title) +
            ' '.repeat(padding) +
            pc.cyan('│'),
    );
    console.log(pc.cyan('└' + '─'.repeat(width - 2) + '┘'));
    console.log();
}

/**
 * Prints a section heading with a separator line.
 * @param title - The section title text
 */
export function printSection(title: string): void {
    console.log();
    console.log(pc.bold(title));
    console.log(pc.dim('━'.repeat(48)));
}

/**
 * Prints a success message with a checkmark icon.
 * @param message - The success message text
 */
export function printSuccess(message: string): void {
    console.log(colors.success(`${icons.success} ${message}`));
}

/**
 * Prints an error message with a cross icon.
 * @param message - The error message text
 */
export function printError(message: string): void {
    console.log(colors.error(`${icons.error} ${message}`));
}

/**
 * Prints a warning message with a warning icon.
 * @param message - The warning message text
 */
export function printWarn(message: string): void {
    console.log(colors.warn(`${icons.warn} ${message}`));
}

/**
 * Prints an info message with an info icon.
 * @param message - The info message text
 */
export function printInfo(message: string): void {
    console.log(colors.info(`${icons.info} ${message}`));
}

export const spinner = {
    start(text: string): Ora {
        return ora(text).start();
    },

    succeed(spinner: Ora, text: string): void {
        spinner.succeed(colors.success(text));
    },

    fail(spinner: Ora, text: string): void {
        spinner.fail(colors.error(text));
    },

    warn(spinner: Ora, text: string): void {
        spinner.warn(colors.warn(text));
    },
};

/**
 * Renders a simple bar chart string using filled/empty squares.
 * @param values - Array of numeric values to sum
 * @param max - The maximum value for the bar scale
 * @param width - The character width of the bar
 * @returns A string of filled and empty squares
 */
export function printBar(values: number[], max: number, width: number = 20): string {
    const filled = Math.round((values.reduce((a, b) => a + b, 0) / max) * width);
    return '■'.repeat(filled) + '□'.repeat(width - filled);
}
