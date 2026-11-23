import pikeImg from '../assets/images/catch_pike_sample_1794599481299.jpg';
import perchImg from '../assets/images/catch_perch_sample_1794599482308.jpg';
import zanderImg from '../assets/images/catch_zander_sample_1794599482588.jpg';

const SAMPLE_PHOTO_MAP: Record<string, string> = {
  'sample:pike': pikeImg,
  'sample:perch': perchImg,
  'sample:zander': zanderImg,
};

export function resolveReportPhotoUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  return SAMPLE_PHOTO_MAP[photoUrl] ?? photoUrl;
}
