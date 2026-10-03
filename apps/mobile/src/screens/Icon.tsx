import { Image, type ImageStyle, type StyleProp } from 'react-native';

// The Sandbee app's Material icons, rendered from its vector drawables to white
// PNG masks (1x/2x/3x) and tinted here: never a text glyph standing in for one.
const ICONS = {
  'arrow-forward': require('../assets/icons/arrow-forward.png'),
  workspace: require('../assets/icons/workspace.png'),
  help: require('../assets/icons/help.png'),
  clear: require('../assets/icons/clear.png'),
  info: require('../assets/icons/info.png'),
  error: require('../assets/icons/error.png'),
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  color,
  size = 20,
  style,
}: {
  name: IconName;
  color: string;
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={ICONS[name]}
      accessible={false}
      resizeMode="contain"
      style={[{ width: size, height: size, tintColor: color }, style]}
    />
  );
}
