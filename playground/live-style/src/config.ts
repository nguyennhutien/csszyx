/**
 * FormConfig — the JSON shape stored in DB / returned from API.
 * This is what a form builder would save per-form.
 */
export interface FormConfig {
    // Form container
    formBg: string;
    formPadding: string;
    formRadius: string;
    formBorderColor: string;
    formShadow: string;

    // Labels
    labelColor: string;
    labelSize: string;

    // Inputs
    inputBg: string;
    inputBorderColor: string;
    inputFocusBorderColor: string;
    inputRadius: string;
    inputPadding: string;
    inputTextColor: string;

    // Submit button
    btnBg: string;
    btnColor: string;
    btnRadius: string;
    btnPadding: string;
    btnHoverBg: string;
}

export const defaultConfig: FormConfig = {
    formBg: '#ffffff',
    formPadding: '32px',
    formRadius: '12px',
    formBorderColor: '#e5e7eb',
    formShadow: '0 4px 24px rgba(0,0,0,0.08)',

    labelColor: '#374151',
    labelSize: '14px',

    inputBg: '#f9fafb',
    inputBorderColor: '#d1d5db',
    inputFocusBorderColor: '#6366f1',
    inputRadius: '8px',
    inputPadding: '10px 14px',
    inputTextColor: '#111827',

    btnBg: '#6366f1',
    btnColor: '#ffffff',
    btnRadius: '8px',
    btnPadding: '12px 24px',
    btnHoverBg: '#4f46e5',
};

/**
 * Convert FormConfig → CSS custom property record.
 * These get injected onto the form container element via useSzVars.
 */
export function configToVars(c: FormConfig): Record<string, string> {
    return {
        '--form-bg':           c.formBg,
        '--form-p':            c.formPadding,
        '--form-r':            c.formRadius,
        '--form-border':       c.formBorderColor,
        '--form-shadow':       c.formShadow,
        '--label-color':       c.labelColor,
        '--label-size':        c.labelSize,
        '--input-bg':          c.inputBg,
        '--input-border':      c.inputBorderColor,
        '--input-focus':       c.inputFocusBorderColor,
        '--input-r':           c.inputRadius,
        '--input-p':           c.inputPadding,
        '--input-color':       c.inputTextColor,
        '--btn-bg':            c.btnBg,
        '--btn-color':         c.btnColor,
        '--btn-r':             c.btnRadius,
        '--btn-p':             c.btnPadding,
        '--btn-hover-bg':      c.btnHoverBg,
    };
}
