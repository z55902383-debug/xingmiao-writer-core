module.exports = {
 appId: "cn.xingmiao.writer.core", productName: "星喵写作开源版", executableName: "XingmiaoWriterCore",
 directories: { output: "release", buildResources: "build" }, asar: true, npmRebuild: false,
 electronDist: require('node:path').join(__dirname,'node_modules/electron/dist'),
 electronVersion: require('node:fs').readFileSync(require('node:path').join(__dirname,'node_modules/electron/dist/version'),'utf8').trim(),
 extraResources: [{from:'build/third-party-licenses',to:'third-party-licenses'}, {from:'LICENSE',to:'LICENSE-core.txt'}],
 files: ["dist/**/*", "electron/**/*", "public/cat-avatar.png", "release.json", "package.json"],
 win: { target: [{target:"nsis",arch:["x64"]}], icon:"build/icon.ico", artifactName:"XingmiaoWriter-Core-${version}-${arch}-Setup.${ext}" },
 nsis: { oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false },
};
