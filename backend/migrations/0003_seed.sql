-- Seed data. Uses INSERT OR IGNORE so this is safe to run more than once.

INSERT OR IGNORE INTO categories (id, slug, name, sort_order) VALUES
  ('cat_tenis', 'tenis', 'Tênis', 1),
  ('cat_bone', 'bone', 'Bonés', 2);

INSERT OR IGNORE INTO products (id, category_id, name, brand, price, tag, rating, reviews, sizes, colors, icon, active, sort_order, description, stock) VALUES
  ('t1', 'cat_tenis', 'Tênis Air Prime Gold', 'Nike', 349.9, 'Novo', 4.8, 96, '["38","39","40","41","42","43"]', '["Dourado","Preto"]', 'tenis', 1, 1, '', NULL),
  ('t2', 'cat_tenis', 'Tênis Runner Black Edition', 'Adidas', 289.9, '', 4.6, 152, '["39","40","41","42","43","44"]', '["Preto"]', 'tenis', 1, 2, '', NULL),
  ('t3', 'cat_tenis', 'Tênis Street Classic', 'Puma', 259.9, '', 4.5, 74, '["38","39","40","41","42"]', '["Branco","Preto"]', 'tenis', 1, 3, '', NULL),
  ('t4', 'cat_tenis', 'Tênis Ultra Comfort White', 'New Balance', 319.9, 'Mais vendido', 4.9, 238, '["39","40","41","42","43"]', '["Branco"]', 'tenis', 1, 4, '', NULL),
  ('t5', 'cat_tenis', 'Tênis Urban Flex Cinza', 'Nike', 279.9, '', 4.4, 51, '["38","39","40","41","42","43","44"]', '["Cinza"]', 'tenis', 1, 5, '', NULL),
  ('b1', 'cat_bone', 'Boné Snapback Gold Crown', 'New Era', 89.9, 'Novo', 4.7, 63, '["Único"]', '["Dourado","Preto"]', 'bone', 1, 6, '', NULL),
  ('b2', 'cat_bone', 'Boné Aba Reta Black Label', 'New Era', 79.9, '', 4.5, 89, '["Único"]', '["Preto"]', 'bone', 1, 7, '', NULL),
  ('b3', 'cat_bone', 'Boné Trucker Premium', 'Adidas', 69.9, '', 4.3, 37, '["Único"]', '["Bege","Preto"]', 'bone', 1, 8, '', NULL),
  ('b4', 'cat_bone', 'Boné Dad Hat Classic', 'Nike', 59.9, 'Mais vendido', 4.8, 171, '["Único"]', '["Preto","Cinza"]', 'bone', 1, 9, '', NULL);

INSERT OR IGNORE INTO coupons (id, code, label, rate, active) VALUES
  ('cp1', 'BEMVINDO10', 'BEMVINDO10 — 10% OFF', 0.1, 1),
  ('cp2', 'FRETEGRATIS', 'FRETEGRATIS — frete grátis', 0, 1);

INSERT OR IGNORE INTO banners (id, position, theme, eyebrow, title, description, cta_label, cta_action, active) VALUES
  ('bn1', 1, 'dark', 'Ruan Pedro Imports', 'Estilo importado, com a sua coroa.', 'Tênis e bonés selecionados a dedo. Crie sua conta, salve seus favoritos e garanta as peças da nova coleção antes de todo mundo.', 'Ver coleção completa', 'catalog:todos', 1),
  ('bn2', 2, 'gold', 'Oferta de boas-vindas', '10% OFF na primeira compra', 'Use o cupom abaixo e garanta seu desconto no primeiro pedido', 'Copiar cupom BEMVINDO10', 'coupon:BEMVINDO10', 1),
  ('bn3', 3, 'dark', 'Envio para todo o Brasil', 'Frete grátis acima de R$ 300', 'Combinamos a entrega direto com você, sem complicação', 'Aproveitar agora', 'catalog:todos', 1);

INSERT OR IGNORE INTO admin_users (id, username, password_hash) VALUES
  ('adm_1', 'ruan', 'e1dc9c9ab1299d1d77e3ccb72ec56cd7:246c98c3111a7f364aa04019fd7664f59ec6353bf601e769081184a53d0bb8eb');
