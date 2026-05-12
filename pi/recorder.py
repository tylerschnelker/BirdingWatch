def calculate_dynamic_threshold(audio_data, window_size=10):
    """
    Calculate a dynamic silence threshold based on the average RMS value over a window.
    """
    rms_values = [calculate_rms(chunk) for chunk in audio_data]
    avg_rms = np.mean(rms_values[-window_size:])
    return avg_rms * 0.5
