import fs from 'fs';
import path from 'path';

const outBase = '/root/.openclaw/TKdown/2026-03-22/001';
const imgDir = path.join(outBase, 'images');
const skuDir = path.join(outBase, 'sku');

const product = {
  title: "2 pcs Wireless Lavalier Microphones for iPhone, Android, iPad - Mini Wireless Clip-on Microphones Crystal Clear Sound Quality for Recording, Live Streaming,Vlog",
  description: "Kind reminder: The product is divided into Lightning Port and USB Type-C(iPhone15) adapters, please purchase according to the actual connector. Apple 15 please purchase USB Type-C",
  price: "$29.99",
  compareAtPrice: "",
  sku: "TK-1729413476776186574",
  status: "active",
  images: fs.readdirSync(imgDir).filter(f => f.endsWith('.webp')).sort(),
  descriptionImages: [],
  _meta: {
    productId: "1729413476776186574",
    source: "tiktok-shop-detail",
    extractedAt: new Date().toISOString(),
    skus: [
      {
        name: "(Noise-reduced upgraded version) iPhone",
        thumbnail: "sku_01_(Noise-reduced upgraded version) iPhone.jpg",
        price: "$29.99",
        detail: "Kind reminder: The product is divided into Lightning Port and USB Type-C(iPhone15) adapters"
      },
      {
        name: "(Noise-reduced upgraded version) Type-C",
        thumbnail: "sku_02_(Noise-reduced upgraded version) Type-C.jpg",
        price: "$29.99",
        detail: "Kind reminder: The product is divided into Lightning Port and USB Type-C(iPhone15) adapters"
      },
      {
        name: "2 PCS-iPhone",
        thumbnail: "sku_03_2 PCS-iPhone.jpg",
        price: "$29.99",
        detail: "Kind reminder: The product is divided into Lightning Port and USB Type-C(iPhone15) adapters"
      },
      {
        name: "2 PCS-Type C",
        thumbnail: "sku_04_2 PCS-Type C.jpg",
        price: "$29.99",
        detail: "Kind reminder: The product is divided into Lightning Port and USB Type-C(iPhone15) adapters"
      }
    ]
  }
};

fs.writeFileSync(path.join(outBase, 'product.json'), JSON.stringify(product, null, 2));
console.log('已更新 product.json');
console.log('图片:', product.images);
console.log('SKU:', product._meta.skus.map(s => s.name));
