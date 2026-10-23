-- All products are stocked in the US: switch to 3-5 business day delivery.
ALTER TABLE products ALTER COLUMN ship_estimate SET DEFAULT '3-5 business days';
UPDATE products SET ship_estimate = '3-5 business days' WHERE ship_estimate = '7-14 business days';
