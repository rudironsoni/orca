import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  addSceneLifecycleToAppDelegate,
  addSceneLifecycleToInfoPlist
} = require('./ios-scene-lifecycle.js')

const appDelegate = `class AppDelegate: ExpoAppDelegate {
  var reactNativeFactory: RCTReactNativeFactory?

  func start() {
    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}`

test('moves React Native startup into the scene delegate', () => {
  const result = addSceneLifecycleToAppDelegate(appDelegate)

  assert.match(result, /var launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?/)
  assert.match(result, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/)
  assert.match(result, /UIWindow\(windowScene: windowScene\)/)
  assert.doesNotMatch(result, /UIWindow\(frame: UIScreen\.main\.bounds\)/)
  assert.equal(addSceneLifecycleToAppDelegate(result), result)
})

test('adds a single-window scene manifest', () => {
  const result = addSceneLifecycleToInfoPlist({ CFBundleDisplayName: 'Horca' })
  const manifest = result.UIApplicationSceneManifest

  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false)
  assert.deepEqual(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication, [
    {
      UISceneConfigurationName: 'Default Configuration',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate'
    }
  ])
})
