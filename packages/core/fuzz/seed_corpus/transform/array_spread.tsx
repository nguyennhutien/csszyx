const BASE = { p: 4 };
export const A = ({ on }) => (
    <div sz={[BASE, on && { bg: 'red-500' }, { dark: { textColor: 'white' } }]} />
);
