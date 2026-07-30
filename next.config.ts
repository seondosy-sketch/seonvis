import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈화면 위젯 PNG(app/api/widget/summary)는 satori로 글자를 직접 그리므로 한글 TTF 파일이
  // 서버 번들에 들어가 있어야 한다. 폰트 경로를 변수로 조립해 읽기 때문에 Next의 자동 파일
  // 추적이 못 잡을 수 있어 명시적으로 포함시킨다(빠지면 배포 후 한글이 빈칸으로 나온다).
  outputFileTracingIncludes: {
    '/api/widget/summary': ['./public/fonts/NotoSansKR-*.ttf'],
  },
};

export default nextConfig;
