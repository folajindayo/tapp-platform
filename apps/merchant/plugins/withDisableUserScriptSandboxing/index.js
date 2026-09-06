const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withIosDisableSandboxing(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      if (typeof configurations[key] === 'object' && configurations[key].buildSettings) {
        configurations[key].buildSettings['ENABLE_USER_SCRIPT_SANDBOXING'] = '"NO"';
      }
    }
    return config;
  });
}

function withPodfileDisableSandboxing(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfilePath)) {
        let content = fs.readFileSync(podfilePath, 'utf-8');
        
        if (!content.includes('ENABLE_USER_SCRIPT_SANDBOXING')) {
          const targetMarker = "config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'\n        end\n      end\n    end";
          if (content.includes(targetMarker)) {
            const replacement = `${targetMarker}\n\n    installer.pods_project.targets.each do |target|\n      target.build_configurations.each do |config|\n        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'\n      end\n    end`;
            content = content.replace(targetMarker, replacement);
            fs.writeFileSync(podfilePath, content, 'utf-8');
          }
        }
      }
      return config;
    }
  ]);
}

module.exports = function withDisableUserScriptSandboxing(config) {
  config = withIosDisableSandboxing(config);
  config = withPodfileDisableSandboxing(config);
  return config;
};
