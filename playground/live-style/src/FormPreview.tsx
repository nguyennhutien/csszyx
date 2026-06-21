import { useRef } from 'react';
import { useSzVars } from '@csszyx/vars/react';
import type { FormConfig } from './config';
import { configToVars } from './config';

interface FormPreviewProps {
    config: FormConfig;
}

export function FormPreview({ config }: FormPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // CSS variables scoped to this container — doesn't affect anything outside
    useSzVars(configToVars(config), containerRef);

    return (
        <div ref={containerRef} sz={{ display: 'flex', flexDir: 'col', items: 'center', justify: 'center', h: 'full', p: 8 }}>
            <form
                sz={{
                    bg: '--form-bg',
                    p: '--form-p',
                    rounded: '--form-r',
                    border: true,
                    borderColor: '--form-border',
                    w: 'full',
                    maxW: 'md',
                    flexDir: 'col',
                    display: 'flex',
                    gap: 5,
                }}
                style={{ boxShadow: 'var(--form-shadow)' }}
                onSubmit={(e) => e.preventDefault()}
            >
                <div sz={{ mb: 2 }}>
                    <h2 sz={{ text: 'xl', weight: 'semibold', color: '--label-color', mb: 1 }}>
                        Contact Us
                    </h2>
                    <p style={{ color: 'var(--label-color)', fontSize: 'var(--label-size)', opacity: 0.6 }}>
                        Fill out the form and we'll be in touch.
                    </p>
                </div>

                <Field label="Full Name" type="text" placeholder="John Doe" />
                <Field label="Email Address" type="email" placeholder="john@example.com" />
                <Field label="Company" type="text" placeholder="Acme Inc." />

                <div sz={{ display: 'flex', flexDir: 'col', gap: 1 }}>
                    <label style={{ color: 'var(--label-color)', fontSize: 'var(--label-size)', fontWeight: 500 }}>
                        Message
                    </label>
                    <textarea
                        rows={4}
                        placeholder="How can we help?"
                        style={{
                            backgroundColor: 'var(--input-bg)',
                            border: '1px solid var(--input-border)',
                            borderRadius: 'var(--input-r)',
                            padding: 'var(--input-p)',
                            color: 'var(--input-color)',
                            fontSize: 'var(--label-size)',
                            width: '100%',
                            resize: 'vertical',
                            outline: 'none',
                            fontFamily: 'inherit',
                            transition: 'border-color 0.15s',
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--input-focus)'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    />
                </div>

                <button
                    type="submit"
                    style={{
                        backgroundColor: 'var(--btn-bg)',
                        color: 'var(--btn-color)',
                        borderRadius: 'var(--btn-r)',
                        padding: 'var(--btn-p)',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 'var(--label-size)',
                        width: '100%',
                        transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--btn-hover-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--btn-bg)'; }}
                >
                    Send Message
                </button>
            </form>
        </div>
    );
}

function Field({ label, type, placeholder }: { label: string; type: string; placeholder: string }) {
    return (
        <div sz={{ display: 'flex', flexDir: 'col', gap: 1 }}>
            <label style={{ color: 'var(--label-color)', fontSize: 'var(--label-size)', fontWeight: 500 }}>
                {label}
            </label>
            <input
                type={type}
                placeholder={placeholder}
                style={{
                    backgroundColor: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    borderRadius: 'var(--input-r)',
                    padding: 'var(--input-p)',
                    color: 'var(--input-color)',
                    fontSize: 'var(--label-size)',
                    width: '100%',
                    outline: 'none',
                    transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--input-focus)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
            />
        </div>
    );
}
