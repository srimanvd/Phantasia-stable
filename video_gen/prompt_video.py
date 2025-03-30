system_prompt = """
can you fix this manim. there are a lot of text overlaps btw. so do replacement transforms and you need to keep a track of where you are writing because once you have written something, you can't write to the same location again since it causes an overlap. the way you can keep a track of this is using comments. use comments to keep a track of this. Be generous in the spacing between math symbols and the text because there has to be a space between math symbols in MathTex and the text so you have to add spacing manually. Math Symbols should be Math Symbols and if there is a symbol in the Text use MathTex and make sure that you put the text in the {text} with spacing please. and make the text look nice too 

YOU CAN slightly reduce the font too. keep your reasoning in the comments in the code as chain of thought so you know what you're doing and Make sure the top most heading to the bottom most thing are on the screen. also please make sure everything fits in the screen and plase heavily rely on clear and  replacementTransforms wherever you can so that you can clear so that things stay. Usually the code generated goes off the screen so please stick to clear or replacementTransform. use font size 30 everywhere please 

One thing is do not RELY too much on .next_to and .move_to because you can't guarantee if that results in things staying in the same screen. I want the code to that you generate to always be on the same screen with NO OVERLAPS. so you can just RELY ON ReplacementTransform Instead and use it a lot when you go from one step to another instead of just .next_to or .move_to (Only use these after a clear() but I ALWAYS want you to rely on ReplacementTransform Function) and if you rely on .next_to and .move_to and then write using a .to_edge(DOWN), you don't know if that overlaps or not. so you don't have to list your work one after the other. JUST USE REPLACEMENTTRANSFORM please ALMOST EVERY TIME. and rely heavily on .clear() function so that there are no overlaps at all
 
IF using Visualizations, make sure everything fits in the pane and is not off the screen, and nothing is overlapping. Please rely on .clear() and ReplacementTransform so that there are absolutely no overalps at all.
 
Please use clear() before and after visualizations and make the visualizations small so that they fit in the viewport. You don't have to put the visualizations and the text together, just clear after showing the visualization so that there is no overlaps. I WANT A VIDEO that looks nice without any overlaps so rely on clear before an after visualiztations. rely on clear as much as you can. 

Please RELY HEAVILY ON CLEAR so that there are no overlaps at all. I WANT NO OVERLAPPING TEXT AT ALL PLEASE. 
 
Use the entire view port pane and please make sure that the visualizations fit correctly. scale them down by a lot and put them in the center, you show them and then clear it. don't overlay or show equations and visualizations together. please make the visualizations small. put them in the center too and small and rely heavily on clear please. I WANT YOU TO ADD VOICE OVERS TOO. if the user doesn't ask for visualizations, don't include any visualizations.
 

PLEASE FOLLOW THESE INSTRUCTIONS STRICTLY. Keep the video short and simple please. clear every scene, and keep the scenes short and simple. PLEASE CLEAR YOUR SCREEN AFTER AND BEFORE VISUALIZATION TO AVOID OVERLAPS. 
"""

gemini_prompt = """
I want you to generate scenes for a Manim Video Generator Don't include any math because this is just a high overview of the scene in brief. In the scene description, please put instructions like clear before and after visualizations. make it simple and clean code. prioritize working code over complex animations
based on the what's asked give about 1-5 scenes in total. keep the scenes short and simple. use 1 scenes and keep the scenes 
just use one scene please. if the user doesn't ask for visualizations, don't include any visualizations.
"""

audio_prompt = """
 VOICE OVER EXAMPLE you need to follow:
 from manim import *
from manim_voiceover import VoiceoverScene
from manim_voiceover.services.elevenlabs import ElevenLabsService
import ssl #is needed 
import numpy as np #is needed

ssl._create_default_https_context = ssl._create_unverified_context #is needed
config.renderer = "cairo" #is needed


#VOICE OVER FORMAT:
class SimpleVoiceoverExample(VoiceoverScene):
    def construct(self):
        self.set_speech_service(
            ElevenLabsService(
                voice_name="Adam",
                voice_settings={"stability": 0.1, "similarity_boost": 0.3}
            )
        )
        title = Text("Hello, World!", font_size=20).to_edge(UP)
        with self.voiceover(text="Hello, World! Welcome to this demo.") as tracker:
            self.play(Write(title), run_time=tracker.duration)
        self.wait(1)

        with self.voiceover(text="That is it about Hello World."):
            self.play(FadeOut(title)) #at the ending it doesn't have run_time because it is not needed since this is the last play 


BASED ON THIS EXAMPLE, GENERATE A VOICE OVER FOR THE MANIM VIDEO for the CODE BELOW. you wrap self.play in with self.voiceover(text="") as tracker: and you put the text in the text="" and you put the run_time=tracker.duration in the play function.
 
for the last play, you don't need to put the run_time=tracker.duration because it is the last play and it doesn't need a run time.
 
in the audio text, you need to put information about the topic not the code or the scene. keep the audio short and crisp talking about the equations and headings and visualizations in really short sentences. do not put thank you or anything like that. just put the information about the topic in the audio.
give me the entire code. Please don't explain or say transitioning to anything. Your Job is to just add audio voice over and explain what's happening in the equations and headings, not talk about the transitions. 
 """
