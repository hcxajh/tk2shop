function cleanDescImgUrl(url) {
  if (!url) return '';
  return url
    .replace(/~tplv-([a-z0-9]+)-crop-webp:(\d+):(\d+)\.webp/gi, '~tplv-$1-origin.webp')
    .replace(/~tplv-([a-z0-9]+)-crop-jpeg:(\d+):(\d+)\.jpeg/gi, '~tplv-$1-origin.jpeg')
    .replace(/~tplv-([a-z0-9]+)-crop-jpg:(\d+):(\d+)\.jpg/gi, '~tplv-$1-origin.jpg')
    .replace(/~tplv-([a-z0-9]+)-resize-png:(\d+):(\d+)\.png/gi, '~tplv-$1-origin.png')
    .replace(/~tplv-([a-z0-9]+)-(\w+):(\d+):(\d+)\.(\w+)/gi, '~tplv-$1-origin.$5');
}

const testUrls = [
  'https://p16-oec-general.ttcdn-us.com/tos-alisg-i-aphluv4xwc-sg/cd1105660af54678a0e290df54413679~tplv-fhlh96nyum-crop-webp:800:1190.webp?dr=12178',
  'https://p16-oec-general.ttcdn-us.com/tos-alisg-i-aphluv4xwc-sg/167a1a11b47f4b7da3a8d16fd5a5f110~tplv-fhlh96nyum-crop-webp:970:600.webp?dr=12178',
  'https://p16-oec-general.ttcdn-us.com/tos-alisg-i-aphluv4xwc-sg/f0f9dc138bc944b0a1809322a8fcb226~tplv-fhlh96nyum-crop-webp:970:300.webp?dr=12178',
  'https://p16-oec-general.ttcdn-us.com/tos-alisg-i-aphluv4xwc-sg/97b4d54868164e79bef7febc98d0b709~tplv-fhlh96nyum-crop-webp:970:300.webp?dr=12178',
  'https://p16-oec-general.ttcdn-us.com/tos-alisg-i-aphluv4xwc-sg/9915e17a878f4f0fb3fdf50bbf95eb63~tplv-fhlh96nyum-crop-webp:970:300.webp?dr=12178',
];

testUrls.forEach((url, i) => {
  console.log(`URL${i+1}: ${cleanDescImgUrl(url)}`);
});
