import { useSz } from '@csszyx/dynamic/react';

// Field configs hold only data — no CSS computed at module level.
// sz() is called inside render, within the React lifecycle managed by useSz.
const FIELD_CONFIGS = [
    { name: 'firstName', label: 'First Name',  style: { p: 3, border: true, rounded: 'md',  w: 'full', text: 'sm' } },
    { name: 'lastName',  label: 'Last Name',   style: { p: 3, border: 2,    rounded: 'lg',  w: 'full', text: 'sm' } },
    { name: 'email',     label: 'Email',       style: { p: 3, border: true, rounded: 'none', w: 'full', text: 'sm' } },
    { name: 'phone',     label: 'Phone',       style: { p: 2, border: true, rounded: 'sm',  w: 'full', text: 'sm' } },
    { name: 'company',   label: 'Company',     style: { p: 4, border: true, rounded: 'xl',  w: 'full', text: 'sm' } },
    { name: 'address',   label: 'Address',     style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'gray-50' } },
    { name: 'city',      label: 'City',        style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'blue-50' } },
    { name: 'state',     label: 'State',       style: { p: 2, border: true, rounded: 'md',  w: 'full', bg: 'green-50' } },
    { name: 'zip',       label: 'ZIP Code',    style: { p: 2, border: true, rounded: 'md',  w: 24,     text: 'sm' } },
    { name: 'country',   label: 'Country',     style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'yellow-50' } },
    { name: 'website',   label: 'Website',     style: { p: 3, border: true, rounded: 'md',  w: 'full', fontFamily: 'mono' } },
    { name: 'twitter',   label: 'Twitter',     style: { p: 3, border: true, rounded: 'md',  w: 'full', color: 'blue-500' } },
    { name: 'linkedin',  label: 'LinkedIn',    style: { p: 3, border: true, rounded: 'md',  w: 'full', color: 'indigo-600' } },
    { name: 'github',    label: 'GitHub',      style: { p: 3, border: true, rounded: 'md',  w: 'full', color: 'gray-900' } },
    { name: 'bio',       label: 'Bio',         style: { p: 3, border: true, rounded: 'md',  w: 'full', leading: 'relaxed' } },
    { name: 'role',      label: 'Role',        style: { p: 3, border: true, rounded: 'md',  w: 'full', fontWeight: 'medium' } },
    { name: 'dept',      label: 'Department',  style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'purple-50' } },
    { name: 'salary',    label: 'Salary',      style: { p: 3, border: true, rounded: 'md',  w: 'full', textAlign: 'right' } },
    { name: 'startDate', label: 'Start Date',  style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'pink-50' } },
    { name: 'notes',     label: 'Notes',       style: { p: 3, border: true, rounded: 'md',  w: 'full', bg: 'orange-50' } },
] as const;

export function DynamicForm() {
    // useSz: manifest is lazily loaded on first sz() call,
    // and CSS sheets are released when this component unmounts.
    const { sz } = useSz();

    return (
        <div
            className={sz({ maxW: '2xl', mx: 'auto', p: 8, bg: 'white', rounded: '2xl', shadow: '2xl' })}
            data-testid="dynamic-form-container"
        >
            <h2 className={sz({ text: '2xl', fontWeight: 'bold', color: 'gray-900', mb: 6 })}>
                Dynamic CSS Injection — 20-Field Form
            </h2>

            <form data-testid="dynamic-form" noValidate>
                <div className={sz({ grid: true, gridCols: 2, gap: 4 })}>
                    {FIELD_CONFIGS.map(({ name, label, style }) => (
                        <div key={name} data-testid={`field-${name}`}>
                            <label
                                htmlFor={name}
                                className={sz({ text: 'sm', fontWeight: 'medium', color: 'gray-700', mb: 1, block: true })}
                            >
                                {label}
                            </label>
                            <input
                                id={name}
                                name={name}
                                type="text"
                                className={sz(style)}
                                placeholder={label}
                                data-testid={`input-${name}`}
                            />
                        </div>
                    ))}
                </div>

                <div className={sz({ mt: 6, flex: true, justify: 'end', gap: 3 })}>
                    <button
                        type="button"
                        className={sz({ px: 4, py: 2, border: true, rounded: 'md', text: 'sm', color: 'gray-700' })}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className={sz({ px: 4, py: 2, bg: 'blue-600', color: 'white', rounded: 'md', text: 'sm', fontWeight: 'medium' })}
                    >
                        Submit
                    </button>
                </div>
            </form>
        </div>
    );
}
