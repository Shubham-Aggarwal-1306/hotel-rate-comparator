import { createSupplierApp } from './app';

const port = Number(process.env.SUPPLIERS_PORT ?? 4001);

createSupplierApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[suppliers] listening on http://localhost:${port} ` +
      `(chaos=${process.env.SUPPLIER_CHAOS === '1' ? 'on' : 'off'})`,
  );
});
