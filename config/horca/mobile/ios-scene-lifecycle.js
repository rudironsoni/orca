const APP_BOOTSTRAP = `    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`

const SCENE_BOOTSTRAP = `    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions`

const REACT_NATIVE_DELEGATE_MARKER = '\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate {'

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    var launchOptions = appDelegate.launchOptions ?? [:]
    if let urlContext = connectionOptions.urlContexts.first {
      launchOptions[.url] = urlContext.url
      launchOptions[.sourceApplication] = urlContext.options.sourceApplication
    }
    if let userActivity = connectionOptions.userActivities.first {
      let userActivityDictionary: [AnyHashable: Any] = [
        UIApplication.LaunchOptionsKey.userActivityType: userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
      launchOptions[.userActivityDictionary] = userActivityDictionary
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
`

function addSceneLifecycleToAppDelegate(contents) {
  if (contents.includes('class SceneDelegate: UIResponder, UIWindowSceneDelegate')) {
    return contents
  }
  if (!contents.includes(APP_BOOTSTRAP) || !contents.includes(REACT_NATIVE_DELEGATE_MARKER)) {
    throw new Error('Expo AppDelegate template changed; cannot add the iOS scene lifecycle')
  }

  return contents
    .replace(
      '  var reactNativeFactory: RCTReactNativeFactory?',
      '  var reactNativeFactory: RCTReactNativeFactory?\n' +
        '  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?'
    )
    .replace(APP_BOOTSTRAP, SCENE_BOOTSTRAP)
    .replace(REACT_NATIVE_DELEGATE_MARKER, `${SCENE_DELEGATE}${REACT_NATIVE_DELEGATE_MARKER}`)
}

function addSceneLifecycleToInfoPlist(infoPlist) {
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate'
          }
        ]
      }
    }
  }
}

function withIosSceneLifecycle(config) {
  const { withAppDelegate, withInfoPlist } = require('expo/config-plugins')
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults = addSceneLifecycleToInfoPlist(cfg.modResults)
    return cfg
  })
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('The Horca iOS scene lifecycle requires a Swift AppDelegate')
    }
    cfg.modResults.contents = addSceneLifecycleToAppDelegate(cfg.modResults.contents)
    return cfg
  })
}

module.exports = withIosSceneLifecycle
module.exports.addSceneLifecycleToAppDelegate = addSceneLifecycleToAppDelegate
module.exports.addSceneLifecycleToInfoPlist = addSceneLifecycleToInfoPlist
